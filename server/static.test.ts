import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { createApp } from './index.js';
import { InMemoryFollowUpStore } from './followupStore.js';

interface TestableApp {
  handle: (req: Request, res: Response, done: () => void) => void;
}

interface StaticResult {
  status: number;
  body: string;
  contentType: string | undefined;
}

const INDEX_HTML =
  '<!doctype html><html><body><div id="root">STATIC-TEST-INDEX</div></body></html>';
const APP_JS = 'console.log("STATIC-TEST-ASSET");';

// In-process HTTP dispatch like server/followups.routes.test.ts, with a
// response double that also accepts streamed file bodies (express.static
// and res.sendFile pipe into res), so no network socket is needed.

function toBuffer(chunk: unknown): Buffer {
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, 'utf8');
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  return Buffer.alloc(0);
}

function createResponseDouble(): {
  res: Record<string, unknown>;
  done: Promise<StaticResult>;
} {
  const headers: Record<string, string | number> = {};
  const chunks: Buffer[] = [];
  const emitter = new EventEmitter();
  let resolveDone!: (value: StaticResult) => void;
  const done = new Promise<StaticResult>((resolve) => {
    resolveDone = resolve;
  });
  const res: Record<string, unknown> = {
    statusCode: 200,
    headersSent: false,
    // send's completion tracker treats an unknown stream state as
    // finished and destroys the file stream, so declare it unfinished.
    writableEnded: false,
    setHeader: (name: string, value: string | number): void => {
      headers[name.toLowerCase()] = value;
    },
    getHeader: (name: string): string | number | undefined =>
      headers[name.toLowerCase()],
    removeHeader: (name: string): void => {
      delete headers[name.toLowerCase()];
    },
    write: (chunk: unknown): boolean => {
      chunks.push(toBuffer(chunk));
      return true;
    },
    end: (chunk?: unknown): void => {
      if (chunk !== undefined) {
        chunks.push(toBuffer(chunk));
      }
      resolveDone({
        status: res['statusCode'] as number,
        body: Buffer.concat(chunks).toString('utf8'),
        contentType: headers['content-type'] as string | undefined,
      });
    },
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    emit: emitter.emit.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
  };
  return { res, done };
}

async function withTimeout(
  promise: Promise<StaticResult>,
  label: string,
): Promise<StaticResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<StaticResult>((_, reject) => {
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

let fixtureDir: string;
let app: TestableApp;

async function dispatch(method: string, url: string): Promise<StaticResult> {
  const { res, done } = createResponseDouble();
  const req: Record<string, unknown> = {
    method,
    url,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  };
  req['res'] = res;
  res['req'] = req;
  app.handle(req as unknown as Request, res as unknown as Response, () => {
    // Fallthrough guard: every exercised path ends the response, so
    // reaching here without end() trips the timeout.
  });
  return withTimeout(done, `${method} ${url}`);
}

describe('production static serving', () => {
  before(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'followthrough-client-'));
    writeFileSync(join(fixtureDir, 'index.html'), INDEX_HTML);
    writeFileSync(join(fixtureDir, 'app.js'), APP_JS);
  });

  after(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    app = createApp(new InMemoryFollowUpStore(), {
      clientDir: fixtureDir,
    }) as unknown as TestableApp;
  });

  it('serves the React application at /', async () => {
    const { status, body, contentType } = await dispatch('GET', '/');
    assert.equal(status, 200);
    assert.ok(body.includes('STATIC-TEST-INDEX'));
    assert.ok(contentType?.includes('text/html'));
  });

  it('falls back to the SPA entry point for page routes', async () => {
    const { status, body } = await dispatch('GET', '/followups');
    assert.equal(status, 200);
    assert.ok(body.includes('STATIC-TEST-INDEX'));
  });

  it('serves static assets directly', async () => {
    const { status, body, contentType } = await dispatch('GET', '/app.js');
    assert.equal(status, 200);
    assert.equal(body, APP_JS);
    assert.ok(contentType?.includes('javascript'));
  });

  it('keeps /api/health a JSON response', async () => {
    const { status, body } = await dispatch('GET', '/api/health');
    assert.equal(status, 200);
    assert.deepEqual(JSON.parse(body) as unknown, { status: 'ok' });
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const { status, body } = await dispatch('GET', '/api/does-not-exist');
    assert.equal(status, 404);
    assert.deepEqual(JSON.parse(body) as unknown, { error: 'Not found.' });
  });

  it('returns 404 for missing static assets', async () => {
    const { status } = await dispatch('GET', '/missing.js');
    assert.equal(status, 404);
  });
});
