import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Response } from 'express';

interface TestableApp {
  handle: (
    req: Request,
    res: Response,
    done: () => void,
  ) => void;
}

interface FollowUpPayload {
  id: string;
  enquiryId: string;
  customer: string;
  subject: string;
  reason: string;
  dueAt: string;
  status: string;
  notes: string;
  overdue: boolean;
}

interface MockResult {
  status: number;
  payload: unknown;
}

// In-process HTTP dispatch: drives the real Express stack
// (routing, query parsing, handlers, error middleware) through
// app.handle with lightweight request/response doubles, so no
// network socket is needed.

function createResponseDouble(): {
  res: Record<string, unknown>;
  done: Promise<MockResult>;
} {
  const headers: Record<string, string | number> = {};
  let resolveDone!: (value: MockResult) => void;
  const done = new Promise<MockResult>((resolve) => {
    resolveDone = resolve;
  });
  const res: Record<string, unknown> = {
    statusCode: 200,
    setHeader: (name: string, value: string | number): void => {
      headers[name.toLowerCase()] = value;
    },
    getHeader: (name: string): string | number | undefined =>
      headers[name.toLowerCase()],
    removeHeader: (name: string): void => {
      delete headers[name.toLowerCase()];
    },
    end: (chunk?: unknown): void => {
      const text =
        typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString('utf8')
            : '';
      let payload: unknown = null;
      if (text !== '') {
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          payload = null;
        }
      }
      resolveDone({ status: res['statusCode'] as number, payload });
    },
  };
  return { res, done };
}

async function withTimeout(
  promise: Promise<MockResult>,
  label: string,
): Promise<MockResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<MockResult>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`request timed out: ${label}`)),
          5000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

let app: TestableApp;
let dir = '';

function storePath(): string {
  return join(dir, 'followups.json');
}

async function dispatch(
  method: string,
  url: string,
  body?: unknown,
): Promise<MockResult> {
  const { res, done } = createResponseDouble();
  const req: Record<string, unknown> = {
    method,
    url,
    headers: {},
    _body: true,
    body,
  };
  app.handle(req as unknown as Request, res as unknown as Response, () => {
    // Fallthrough guard: every route and error handler ends the
    // response, so reaching here without end() trips the timeout.
  });
  return withTimeout(done, `${method} ${url}`);
}

function validBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    enquiryId: 'enq-1',
    customer: 'Amelia Hart',
    subject: 'Quote for 6-month checkup plan',
    reason: 'Send the revised quote.',
    dueAt: '2026-11-05T10:00:00.000Z',
    ...overrides,
  };
}

function singleFollowUp(payload: unknown): FollowUpPayload {
  return (payload as { followUp: FollowUpPayload }).followUp;
}

function followUpList(payload: unknown): FollowUpPayload[] {
  return (payload as { followUps: FollowUpPayload[] }).followUps;
}

describe('follow-up api routes', () => {
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'followups-routes-test-'));
    process.env.FOLLOWUPS_FILE = storePath();
    const module = await import('./index.js');
    app = module.default as unknown as TestableApp;
  });

  after(() => {
    delete process.env.FOLLOWUPS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    writeFileSync(storePath(), '[]', 'utf8');
  });

  it('returns an empty list when no follow-ups exist', async () => {
    const { status, payload } = await dispatch('GET', '/api/followups');
    assert.equal(status, 200);
    assert.deepEqual(followUpList(payload), []);
  });

  it('creates a follow-up and returns it with a derived overdue flag', async () => {
    const { status, payload } = await dispatch(
      'POST',
      '/api/followups',
      validBody(),
    );
    assert.equal(status, 201);
    const created = singleFollowUp(payload);
    assert.ok(created.id !== '');
    assert.equal(created.status, 'pending');
    assert.equal(created.overdue, false);
    assert.equal(created.enquiryId, 'enq-1');
  });

  it('lists created follow-ups', async () => {
    await dispatch('POST', '/api/followups', validBody());
    await dispatch('POST', '/api/followups', validBody({ enquiryId: 'enq-2' }));
    const { status, payload } = await dispatch('GET', '/api/followups');
    assert.equal(status, 200);
    assert.equal(followUpList(payload).length, 2);
  });

  it('filters by enquiryId', async () => {
    await dispatch('POST', '/api/followups', validBody({ enquiryId: 'enq-1' }));
    await dispatch('POST', '/api/followups', validBody({ enquiryId: 'enq-2' }));
    const { status, payload } = await dispatch(
      'GET',
      '/api/followups?enquiryId=enq-2',
    );
    assert.equal(status, 200);
    const list = followUpList(payload);
    assert.equal(list.length, 1);
    assert.equal(list[0].enquiryId, 'enq-2');
  });

  it('filters by status', async () => {
    const created = singleFollowUp(
      (await dispatch('POST', '/api/followups', validBody())).payload,
    );
    await dispatch('POST', '/api/followups', validBody({ enquiryId: 'enq-2' }));
    await dispatch('PATCH', `/api/followups/${created.id}`, {
      status: 'completed',
    });
    const completed = await dispatch('GET', '/api/followups?status=completed');
    assert.equal(completed.status, 200);
    assert.equal(followUpList(completed.payload).length, 1);
    const pending = await dispatch('GET', '/api/followups?status=pending');
    assert.equal(pending.status, 200);
    assert.equal(followUpList(pending.payload).length, 1);
  });

  it('rejects an invalid status filter', async () => {
    const { status, payload } = await dispatch(
      'GET',
      '/api/followups?status=overdue',
    );
    assert.equal(status, 400);
    assert.ok(typeof (payload as { error: unknown }).error === 'string');
  });

  it('rejects invalid create input', async () => {
    const { status } = await dispatch('POST', '/api/followups', {
      ...validBody(),
      reason: '  ',
    });
    assert.equal(status, 400);
    const { payload } = await dispatch('GET', '/api/followups');
    assert.deepEqual(followUpList(payload), []);
  });

  it('completing preserves notes', async () => {
    const created = singleFollowUp(
      (await dispatch('POST', '/api/followups', validBody({ notes: 'Outcome: quoted.' })))
        .payload,
    );
    const { status, payload } = await dispatch(
      'PATCH',
      `/api/followups/${created.id}`,
      { status: 'completed' },
    );
    assert.equal(status, 200);
    const updated = singleFollowUp(payload);
    assert.equal(updated.status, 'completed');
    assert.equal(updated.notes, 'Outcome: quoted.');
  });

  it('rescheduling updates the existing record', async () => {
    const created = singleFollowUp(
      (await dispatch('POST', '/api/followups', validBody())).payload,
    );
    const { status, payload } = await dispatch(
      'PATCH',
      `/api/followups/${created.id}`,
      { dueAt: '2026-12-01T09:00:00.000Z' },
    );
    assert.equal(status, 200);
    const updated = singleFollowUp(payload);
    assert.equal(updated.id, created.id);
    assert.equal(updated.dueAt, '2026-12-01T09:00:00.000Z');
    const { payload: listPayload } = await dispatch('GET', '/api/followups');
    assert.equal(followUpList(listPayload).length, 1);
  });

  it('returns 404 for a missing id', async () => {
    const { status } = await dispatch('PATCH', '/api/followups/does-not-exist', {
      status: 'completed',
    });
    assert.equal(status, 404);
  });

  it('rejects invalid patch input', async () => {
    const created = singleFollowUp(
      (await dispatch('POST', '/api/followups', validBody())).payload,
    );
    const { status } = await dispatch('PATCH', `/api/followups/${created.id}`, {
      status: 'overdue',
    });
    assert.equal(status, 400);
  });

  it('returns 500 with a clear error when storage is corrupted', async () => {
    writeFileSync(storePath(), '{oops', 'utf8');
    const listed = await dispatch('GET', '/api/followups');
    assert.equal(listed.status, 500);
    const listedError = (listed.payload as { error: unknown }).error;
    assert.ok(typeof listedError === 'string' && listedError !== '');
    const created = await dispatch('POST', '/api/followups', validBody());
    assert.equal(created.status, 500);
  });

  it('does not expose filesystem details in storage errors', async () => {
    const previous = process.env.FOLLOWUPS_FILE;
    process.env.FOLLOWUPS_FILE = dir;
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]): void => {
      logged.push(args.map((part) => String(part)).join(' '));
    };
    try {
      const { status, payload } = await dispatch('GET', '/api/followups');
      assert.equal(status, 500);
      const message = (payload as { error: unknown }).error;
      assert.equal(
        message,
        'Unable to access follow-up storage. Please try again later.',
      );
      assert.ok(!String(message).includes(dir));
      assert.ok(
        logged.some((line) => line.includes('Could not read follow-up store')),
      );
    } finally {
      console.error = originalError;
      if (previous === undefined) {
        delete process.env.FOLLOWUPS_FILE;
      } else {
        process.env.FOLLOWUPS_FILE = previous;
      }
    }
  });
});
