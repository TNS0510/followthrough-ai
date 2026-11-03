import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { createApp } from './index.js';
import { FollowUpStoreError } from './followups.js';
import type { FollowUp, FollowUpPatch, NewFollowUp } from './followups.js';
import { InMemoryFollowUpStore } from './followupStore.js';
import type { FollowUpFilters, FollowUpStore } from './followupStore.js';

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
    // The AI rate limiters read the socket peer address, like
    // server/rateLimit.test.ts; follow-up and health paths ignore it.
    socket: { remoteAddress: '127.0.0.1' },
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

const SECRET_MARKER = 'SECRET-should-never-appear-in-logs-or-responses';

// Simulates the production PostgreSQL store failing: logs once with a
// generic message (never the internal detail), then throws generic.
class FailingStore implements FollowUpStore {
  async list(filters?: FollowUpFilters): Promise<FollowUp[]> {
    void filters;
    const internalDetail = `simulated db failure (${SECRET_MARKER})`;
    void internalDetail;
    console.error('[followupStore] postgres list failed');
    throw new FollowUpStoreError('Unable to access follow-up storage.');
  }

  async create(input: NewFollowUp): Promise<FollowUp> {
    void input;
    console.error('[followupStore] postgres create failed');
    throw new FollowUpStoreError('Unable to access follow-up storage.');
  }

  async update(id: string, patch: FollowUpPatch): Promise<FollowUp | null> {
    void id;
    void patch;
    console.error('[followupStore] postgres update failed');
    throw new FollowUpStoreError('Unable to access follow-up storage.');
  }
}

describe('follow-up api routes', () => {
  beforeEach(() => {
    // This suite exercises the handlers, so it opts into the routes that
    // are disabled by default (see 'follow-up route gating' below).
    app = createApp(new InMemoryFollowUpStore(), {
      enableFollowups: true,
    }) as unknown as TestableApp;
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

  it('returns 500 with a clear error when storage fails', async () => {
    app = createApp(new FailingStore(), {
      enableFollowups: true,
    }) as unknown as TestableApp;
    const listed = await dispatch('GET', '/api/followups');
    assert.equal(listed.status, 500);
    assert.equal(
      (listed.payload as { error: unknown }).error,
      'Unable to access follow-up storage. Please try again later.',
    );
    const created = await dispatch('POST', '/api/followups', validBody());
    assert.equal(created.status, 500);
    assert.equal(
      (created.payload as { error: unknown }).error,
      'Unable to access follow-up storage. Please try again later.',
    );
  });

  it('does not expose storage details in errors and logs once', async () => {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]): void => {
      logged.push(args.map((part) => String(part)).join(' '));
    };
    try {
      app = createApp(new FailingStore(), {
        enableFollowups: true,
      }) as unknown as TestableApp;
      const { status, payload } = await dispatch('GET', '/api/followups');
      assert.equal(status, 500);
      const message = (payload as { error: unknown }).error;
      assert.equal(
        message,
        'Unable to access follow-up storage. Please try again later.',
      );
      assert.ok(!String(message).includes(SECRET_MARKER));
      assert.equal(logged.length, 1);
      assert.ok(!logged.some((line) => line.includes(SECRET_MARKER)));
    } finally {
      console.error = originalError;
    }
  });
});

describe('follow-up route gating', () => {
  let savedEnv: string | undefined = undefined;

  beforeEach(() => {
    // Default-off tests must not depend on the ambient environment.
    savedEnv = process.env.ENABLE_FOLLOWUPS;
    delete process.env.ENABLE_FOLLOWUPS;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.ENABLE_FOLLOWUPS;
    } else {
      process.env.ENABLE_FOLLOWUPS = savedEnv;
    }
  });

  it('denies read, create, and update when disabled by default', async () => {
    // Production-like default: no option, no env. The shared store holds a
    // real record, proving the 404s come from gating, not empty storage.
    const store = new InMemoryFollowUpStore();
    const enabled = createApp(store, {
      enableFollowups: true,
    }) as unknown as TestableApp;
    app = enabled;
    const seeded = singleFollowUp(
      (await dispatch('POST', '/api/followups', validBody())).payload,
    );
    app = createApp(store) as unknown as TestableApp;
    const listed = await dispatch('GET', '/api/followups');
    assert.equal(listed.status, 404);
    assert.deepEqual(listed.payload, { error: 'Not found.' });
    const created = await dispatch(
      'POST',
      '/api/followups',
      validBody({ enquiryId: 'enq-2' }),
    );
    assert.equal(created.status, 404);
    assert.deepEqual(created.payload, { error: 'Not found.' });
    const updated = await dispatch('PATCH', `/api/followups/${seeded.id}`, {
      status: 'completed',
    });
    assert.equal(updated.status, 404);
    assert.deepEqual(updated.payload, { error: 'Not found.' });
    // Nothing changed in storage: still one pending record.
    app = enabled;
    const { payload } = await dispatch('GET', '/api/followups');
    const rows = followUpList(payload);
    assert.equal(rows.length, 1);
    assert.deepEqual(
      rows.map((row) => row.status),
      ['pending'],
    );
  });

  it('enables routes when ENABLE_FOLLOWUPS is true', async () => {
    process.env.ENABLE_FOLLOWUPS = 'true';
    app = createApp(new InMemoryFollowUpStore()) as unknown as TestableApp;
    const listed = await dispatch('GET', '/api/followups');
    assert.equal(listed.status, 200);
    assert.deepEqual(followUpList(listed.payload), []);
    const created = await dispatch('POST', '/api/followups', validBody());
    assert.equal(created.status, 201);
  });

  it('keeps routes disabled for other ENABLE_FOLLOWUPS values', async () => {
    process.env.ENABLE_FOLLOWUPS = 'yes';
    app = createApp(new InMemoryFollowUpStore()) as unknown as TestableApp;
    const { status, payload } = await dispatch('GET', '/api/followups');
    assert.equal(status, 404);
    assert.deepEqual(payload, { error: 'Not found.' });
  });

  it('leaves health and analyze routes working when disabled', async () => {
    app = createApp(new InMemoryFollowUpStore()) as unknown as TestableApp;
    const health = await dispatch('GET', '/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.payload, { status: 'ok' });
    // 400 proves the AI route is reachable: the request passed the rate
    // limiters and was rejected by request validation instead.
    const analyzed = await dispatch('POST', '/api/analyze-enquiry', {});
    assert.equal(analyzed.status, 400);
  });

  it('exposes no credentials or internals in disabled responses', async () => {
    app = createApp(new InMemoryFollowUpStore()) as unknown as TestableApp;
    const { status, payload } = await dispatch('GET', '/api/followups');
    assert.equal(status, 404);
    assert.deepEqual(payload, { error: 'Not found.' });
    const text = JSON.stringify(payload).toLowerCase();
    for (const leaked of [
      'database',
      'postgres',
      'database_url',
      'secret',
      'stack',
      'followup',
      'follow_up',
      'store',
      'internal',
    ]) {
      assert.ok(
        !text.includes(leaked),
        `response leaks implementation detail: ${leaked}`,
      );
    }
  });
});
