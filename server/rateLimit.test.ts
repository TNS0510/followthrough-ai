import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { createApp } from './index.js';
import { InMemoryFollowUpStore } from './followupStore.js';

interface TestableApp {
  handle: (req: Request, res: Response, done: () => void) => void;
}

interface LimitResult {
  status: number;
  body: string;
  headers: Record<string, string | number | undefined>;
}

interface DispatchOptions {
  body?: unknown;
  headers?: Record<string, string>;
  peer?: string;
}

// In-process HTTP dispatch like server/followups.routes.test.ts: drives the
// real Express stack through app.handle with lightweight doubles, so no
// network socket is needed. Every request carries an explicit socket peer
// address (documentation-range IPs only, never real addresses).

function createResponseDouble(): {
  res: Record<string, unknown>;
  done: Promise<LimitResult>;
} {
  const headers: Record<string, string | number> = {};
  let resolveDone!: (value: LimitResult) => void;
  const done = new Promise<LimitResult>((resolve) => {
    resolveDone = resolve;
  });
  const res: Record<string, unknown> = {
    statusCode: 200,
    headersSent: false,
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
      resolveDone({
        status: res['statusCode'] as number,
        body: text,
        headers: { ...headers },
      });
    },
  };
  return { res, done };
}

async function withTimeout(
  promise: Promise<LimitResult>,
  label: string,
): Promise<LimitResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<LimitResult>((_, reject) => {
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
  options: DispatchOptions = {},
): Promise<LimitResult> {
  const { res, done } = createResponseDouble();
  const req: Record<string, unknown> = {
    method,
    url,
    headers: options.headers ?? {},
    socket: { remoteAddress: options.peer ?? '192.0.2.1' },
    _body: true,
    body: options.body,
  };
  req['res'] = res;
  res['req'] = req;
  app.handle(req as unknown as Request, res as unknown as Response, () => {
    // Fallthrough guard: every exercised path ends the response, so
    // reaching here without end() trips the timeout.
  });
  return withTimeout(done, `${method} ${url}`);
}

// Invalid analyze payloads are rejected with 400 by request validation
// before any upstream call, so these tests never touch the Meta API, need
// no API key, and a 400 proves the request passed the rate limiter.
const INVALID_ANALYZE_BODY = {};

describe('ai endpoint rate limiting', () => {
  beforeEach(() => {
    // Fresh app per test: each limiter gets an isolated counter store.
    // Follow-up routes are enabled so the scope tests exercise real
    // handlers (gating itself is covered in followups.routes.test.ts).
    app = createApp(new InMemoryFollowUpStore(), {
      enableFollowups: true,
    }) as unknown as TestableApp;
  });

  it('allows the first 10 requests from one client', async () => {
    for (let n = 0; n < 10; n++) {
      const { status } = await dispatch('POST', '/api/analyze-enquiry', {
        body: INVALID_ANALYZE_BODY,
        peer: '192.0.2.1',
      });
      assert.equal(status, 400);
    }
  });

  it('rejects the 11th request with HTTP 429', async () => {
    for (let n = 0; n < 10; n++) {
      await dispatch('POST', '/api/analyze-enquiry', {
        body: INVALID_ANALYZE_BODY,
        peer: '192.0.2.2',
      });
    }
    const { status, body } = await dispatch('POST', '/api/analyze-enquiry', {
      body: INVALID_ANALYZE_BODY,
      peer: '192.0.2.2',
    });
    assert.equal(status, 429);
    assert.deepEqual(JSON.parse(body) as unknown, {
      error: 'Too many requests. Please try again shortly.',
    });
  });

  it('sends standard rate-limit headers without legacy ones', async () => {
    const { headers } = await dispatch('POST', '/api/analyze-enquiry', {
      body: INVALID_ANALYZE_BODY,
      peer: '192.0.2.3',
    });
    assert.equal(headers['ratelimit-limit'], '10');
    assert.equal(headers['ratelimit-remaining'], '9');
    assert.ok(headers['ratelimit-reset'] !== undefined);
    for (const name of Object.keys(headers)) {
      assert.ok(
        !name.startsWith('x-ratelimit'),
        `legacy header present: ${name}`,
      );
    }
  });

  it('leaves /api/health unaffected', async () => {
    for (let n = 0; n < 15; n++) {
      const { status, body } = await dispatch('GET', '/api/health', {
        peer: '192.0.2.4',
      });
      assert.equal(status, 200);
      assert.deepEqual(JSON.parse(body) as unknown, { status: 'ok' });
    }
  });

  it('leaves follow-up routes unaffected', async () => {
    for (let n = 0; n < 12; n++) {
      const { status } = await dispatch('GET', '/api/followups', {
        peer: '192.0.2.5',
      });
      assert.equal(status, 200);
    }
  });

  it('tracks different client IPs separately', async () => {
    for (let n = 0; n < 10; n++) {
      await dispatch('POST', '/api/analyze-enquiry', {
        body: INVALID_ANALYZE_BODY,
        peer: '192.0.2.6',
      });
    }
    const blocked = await dispatch('POST', '/api/analyze-enquiry', {
      body: INVALID_ANALYZE_BODY,
      peer: '192.0.2.6',
    });
    assert.equal(blocked.status, 429);
    const other = await dispatch('POST', '/api/analyze-enquiry', {
      body: INVALID_ANALYZE_BODY,
      peer: '192.0.2.7',
    });
    assert.equal(other.status, 400);
  });

  it('honors CF-Connecting-IP from private peers, ignoring X-Forwarded-For', async () => {
    const viaProxy = {
      body: INVALID_ANALYZE_BODY,
      peer: '10.0.0.5',
      headers: {
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '9.9.9.9',
      },
    };
    for (let n = 0; n < 10; n++) {
      const { status } = await dispatch(
        'POST',
        '/api/analyze-enquiry',
        viaProxy,
      );
      assert.equal(status, 400);
    }
    const blocked = await dispatch('POST', '/api/analyze-enquiry', viaProxy);
    assert.equal(blocked.status, 429);
    // Same visitor behind a changed (spoofed) X-Forwarded-For stays blocked:
    // the spoofed header is not part of the client key.
    const spoofed = await dispatch('POST', '/api/analyze-enquiry', {
      ...viaProxy,
      headers: {
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '1.1.1.1',
      },
    });
    assert.equal(spoofed.status, 429);
    // A different CF-Connecting-IP is a different client.
    const other = await dispatch('POST', '/api/analyze-enquiry', {
      ...viaProxy,
      headers: {
        'cf-connecting-ip': '203.0.113.8',
        'x-forwarded-for': '9.9.9.9',
      },
    });
    assert.equal(other.status, 400);
  });

  it('ignores CF-Connecting-IP from public peers', async () => {
    const forged = {
      body: INVALID_ANALYZE_BODY,
      headers: { 'cf-connecting-ip': '203.0.113.99' },
    };
    for (let n = 0; n < 10; n++) {
      await dispatch('POST', '/api/analyze-enquiry', {
        ...forged,
        peer: '198.51.100.9',
      });
    }
    const blocked = await dispatch('POST', '/api/analyze-enquiry', {
      ...forged,
      peer: '198.51.100.9',
    });
    assert.equal(blocked.status, 429);
    // Same forged header from another public peer is a separate client:
    // the header is not trusted off-platform.
    const other = await dispatch('POST', '/api/analyze-enquiry', {
      ...forged,
      peer: '198.51.100.10',
    });
    assert.equal(other.status, 400);
  });

  it('groups IPv6 peers by /56 subnet', async () => {
    const first = '2001:db8:abcd:12::1';
    const second = '2001:db8:abcd:12::2';
    for (let n = 0; n < 5; n++) {
      const a = await dispatch('POST', '/api/analyze-enquiry', {
        body: INVALID_ANALYZE_BODY,
        peer: first,
      });
      assert.equal(a.status, 400);
      const b = await dispatch('POST', '/api/analyze-enquiry', {
        body: INVALID_ANALYZE_BODY,
        peer: second,
      });
      assert.equal(b.status, 400);
    }
    const blocked = await dispatch('POST', '/api/analyze-enquiry', {
      body: INVALID_ANALYZE_BODY,
      peer: first,
    });
    assert.equal(blocked.status, 429);
    const otherSubnet = await dispatch('POST', '/api/analyze-enquiry', {
      body: INVALID_ANALYZE_BODY,
      peer: '2001:db8:abce:12::1',
    });
    assert.equal(otherSubnet.status, 400);
  });

  it('groups IPv6 CF-Connecting-IP values by /56 subnet', async () => {
    const viaProxy = {
      body: INVALID_ANALYZE_BODY,
      peer: '10.0.0.7',
    };
    for (let n = 0; n < 5; n++) {
      const a = await dispatch('POST', '/api/analyze-enquiry', {
        ...viaProxy,
        headers: { 'cf-connecting-ip': '2001:db8:abcd:34::1' },
      });
      assert.equal(a.status, 400);
      const b = await dispatch('POST', '/api/analyze-enquiry', {
        ...viaProxy,
        headers: { 'cf-connecting-ip': '2001:db8:abcd:34::2' },
      });
      assert.equal(b.status, 400);
    }
    const blocked = await dispatch('POST', '/api/analyze-enquiry', {
      ...viaProxy,
      headers: { 'cf-connecting-ip': '2001:db8:abcd:34::3' },
    });
    assert.equal(blocked.status, 429);
  });

  it('falls back to the peer for a malformed CF-Connecting-IP', async () => {
    const malformed = {
      body: INVALID_ANALYZE_BODY,
      peer: '10.0.0.6',
      headers: { 'cf-connecting-ip': 'not-an-ip' },
    };
    for (let n = 0; n < 10; n++) {
      const { status } = await dispatch(
        'POST',
        '/api/analyze-enquiry',
        malformed,
      );
      assert.equal(status, 400);
    }
    const blocked = await dispatch('POST', '/api/analyze-enquiry', malformed);
    assert.equal(blocked.status, 429);
    // Same peer without the header shares the peer bucket.
    const noHeader = await dispatch('POST', '/api/analyze-enquiry', {
      body: INVALID_ANALYZE_BODY,
      peer: '10.0.0.6',
    });
    assert.equal(noHeader.status, 429);
  });

  it('shares one global quota across client IPs: first 100 allowed, 101st rejected', async () => {
    // 20 distinct documentation-range clients x 5 requests each: every IP
    // stays under its 10/min per-IP budget, so all 100 pass both limiters
    // (400 = passed the limiters, rejected by request validation).
    const peers = Array.from({ length: 20 }, (_, i) => `203.0.113.${64 + i}`);
    let allowed = 0;
    for (const peer of peers) {
      for (let n = 0; n < 5; n++) {
        const { status } = await dispatch('POST', '/api/analyze-enquiry', {
          body: INVALID_ANALYZE_BODY,
          peer,
        });
        assert.equal(status, 400);
        allowed += 1;
      }
    }
    assert.equal(allowed, 100);
    // A brand-new client IP shares the exhausted global quota.
    const blocked = await dispatch('POST', '/api/analyze-enquiry', {
      body: INVALID_ANALYZE_BODY,
      peer: '203.0.113.200',
    });
    assert.equal(blocked.status, 429);
    assert.deepEqual(JSON.parse(blocked.body) as unknown, {
      error: 'Too many requests. Please try again shortly.',
    });
  });

  it('keeps the per-IP limit working below the global quota', async () => {
    // Only 12 total requests: the global 100/hr quota is far from
    // exhausted, so the 429 below must come from the per-IP limiter.
    for (let n = 0; n < 10; n++) {
      const { status } = await dispatch('POST', '/api/analyze-enquiry', {
        body: INVALID_ANALYZE_BODY,
        peer: '192.0.2.50',
      });
      assert.equal(status, 400);
    }
    const blocked = await dispatch('POST', '/api/analyze-enquiry', {
      body: INVALID_ANALYZE_BODY,
      peer: '192.0.2.50',
    });
    assert.equal(blocked.status, 429);
    const other = await dispatch('POST', '/api/analyze-enquiry', {
      body: INVALID_ANALYZE_BODY,
      peer: '192.0.2.51',
    });
    assert.equal(other.status, 400);
  });

  it('leaves health and follow-up routes unaffected after the global quota is exhausted', async () => {
    const peers = Array.from({ length: 20 }, (_, i) => `203.0.113.${100 + i}`);
    for (const peer of peers) {
      for (let n = 0; n < 5; n++) {
        await dispatch('POST', '/api/analyze-enquiry', {
          body: INVALID_ANALYZE_BODY,
          peer,
        });
      }
    }
    const blocked = await dispatch('POST', '/api/analyze-enquiry', {
      body: INVALID_ANALYZE_BODY,
      peer: '203.0.113.200',
    });
    assert.equal(blocked.status, 429);
    const health = await dispatch('GET', '/api/health', {
      peer: '203.0.113.200',
    });
    assert.equal(health.status, 200);
    const followUps = await dispatch('GET', '/api/followups', {
      peer: '203.0.113.200',
    });
    assert.equal(followUps.status, 200);
  });

  it('returns a generic 429 without internal details when the global quota is exhausted', async () => {
    const peers = Array.from({ length: 20 }, (_, i) => `192.0.2.${100 + i}`);
    for (const peer of peers) {
      for (let n = 0; n < 5; n++) {
        await dispatch('POST', '/api/analyze-enquiry', {
          body: INVALID_ANALYZE_BODY,
          peer,
        });
      }
    }
    const blocked = await dispatch('POST', '/api/analyze-enquiry', {
      body: INVALID_ANALYZE_BODY,
      peer: '192.0.2.200',
    });
    assert.equal(blocked.status, 429);
    assert.deepEqual(JSON.parse(blocked.body) as unknown, {
      error: 'Too many requests. Please try again shortly.',
    });
    const lowered = blocked.body.toLowerCase();
    for (const leaked of [
      'global',
      'redis',
      'memory',
      'store',
      'window',
      'keygenerator',
      'ratelimit',
      'rate-limit',
      'express',
      'stack',
      'quota',
    ]) {
      assert.ok(
        !lowered.includes(leaked),
        `response leaks implementation detail: ${leaked}`,
      );
    }
    for (const name of Object.keys(blocked.headers)) {
      assert.ok(
        !name.startsWith('x-ratelimit'),
        `legacy header present: ${name}`,
      );
    }
  });
});
