import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
} from 'openai';
import {
  UpstreamError,
  collectTransportDiagnostic,
} from './metaClient.js';

describe('collectTransportDiagnostic', () => {
  it('returns undefined for non-connection errors', () => {
    assert.equal(collectTransportDiagnostic(new Error('boom')), undefined);
    assert.equal(collectTransportDiagnostic(new TypeError('bad')), undefined);
    assert.equal(collectTransportDiagnostic('boom'), undefined);
    assert.equal(collectTransportDiagnostic(null), undefined);
    assert.equal(collectTransportDiagnostic(undefined), undefined);
  });

  it('describes a timeout with no cause', () => {
    const error = new APIConnectionTimeoutError();
    assert.equal(
      collectTransportDiagnostic(error),
      'code=n/a errno=n/a syscall=n/a hasCause=false cause=n/a causeCode=n/a',
    );
  });

  it('surfaces deep transport fields without leaking unsafe values', () => {
    const root = new APIConnectionTimeoutError({ message: 'Request timed out.' });
    const fetchFailure = new TypeError('fetch failed');
    const transport = {
      code: 'ENOTFOUND',
      errno: -3008,
      syscall: 'getaddrinfo',
      hostname: 'internal-hostname-never-log',
      message: 'secret-marker-never-log',
    };
    Object.assign(fetchFailure, { cause: transport });
    Object.assign(root, { cause: fetchFailure });

    const fragment = collectTransportDiagnostic(root);
    assert.equal(
      fragment,
      'code=ENOTFOUND errno=-3008 syscall=getaddrinfo ' +
        'hasCause=true cause=TypeError causeCode=ENOTFOUND',
    );
    assert.ok(!fragment?.includes('internal-hostname-never-log'));
    assert.ok(!fragment?.includes('secret-marker-never-log'));
    assert.ok(!fragment?.includes('fetch failed'));
  });

  it('rejects unsafe transport values', () => {
    const error = new APIConnectionError({ message: 'Connection error.' });
    Object.assign(error, {
      code: 'NOT A CODE; rm -rf',
      errno: 1.5,
      syscall: '../../etc/passwd',
    });
    assert.equal(
      collectTransportDiagnostic(error),
      'code=n/a errno=n/a syscall=n/a hasCause=false cause=n/a causeCode=n/a',
    );

    const urlCode = new APIConnectionError({ message: 'Connection error.' });
    Object.assign(urlCode, { cause: { code: 'https://evil.example/x' } });
    assert.equal(
      collectTransportDiagnostic(urlCode),
      'code=n/a errno=n/a syscall=n/a hasCause=true cause=n/a causeCode=n/a',
    );
  });

  it('treats a primitive cause as present but unreadable', () => {
    const error = new APIConnectionTimeoutError();
    Object.assign(error, { cause: 'oops-string-cause' });
    assert.equal(
      collectTransportDiagnostic(error),
      'code=n/a errno=n/a syscall=n/a hasCause=true cause=n/a causeCode=n/a',
    );
  });

  it('terminates on cyclic causes', () => {
    const root = new APIConnectionError({ message: 'Connection error.' });
    const middle = new Error('middle');
    Object.assign(root, { cause: middle });
    Object.assign(middle, { cause: root });
    assert.equal(
      collectTransportDiagnostic(root),
      'code=n/a errno=n/a syscall=n/a hasCause=true cause=Error causeCode=n/a',
    );
  });

  it('ignores causes beyond the depth bound', () => {
    const root = new APIConnectionTimeoutError();
    const first = new Error('first');
    const second = new Error('second');
    const third = new Error('third');
    Object.assign(third, { cause: { code: 'BEYOND_BOUND' } });
    Object.assign(second, { cause: third });
    Object.assign(first, { cause: second });
    Object.assign(root, { cause: first });
    assert.equal(
      collectTransportDiagnostic(root),
      'code=n/a errno=n/a syscall=n/a hasCause=true cause=Error causeCode=n/a',
    );
  });

  it('captures DOMException AbortError name and numeric code', () => {
    const root = new APIConnectionTimeoutError({ message: 'Request timed out.' });
    Object.assign(root, {
      cause: new DOMException('This operation was aborted.', 'AbortError'),
    });
    assert.equal(
      collectTransportDiagnostic(root),
      'code=20 errno=n/a syscall=n/a hasCause=true cause=AbortError causeCode=20',
    );
  });

  it('accepts small numeric codes and rejects invalid ones', () => {
    const ok = new APIConnectionError({ message: 'Connection error.' });
    Object.assign(ok, { code: 9999 });
    assert.equal(
      collectTransportDiagnostic(ok),
      'code=9999 errno=n/a syscall=n/a hasCause=false cause=n/a causeCode=n/a',
    );

    for (const code of [10000, -1, Number.NaN, 1.5]) {
      const bad = new APIConnectionError({ message: 'Connection error.' });
      Object.assign(bad, { code });
      assert.equal(
        collectTransportDiagnostic(bad),
        'code=n/a errno=n/a syscall=n/a hasCause=false cause=n/a causeCode=n/a',
      );
    }
  });

  it('prefers the actual name but keeps the constructor fallback', () => {
    const custom = new APIConnectionTimeoutError();
    const renamed = new TypeError('renamed');
    renamed.name = 'CustomName';
    Object.assign(custom, { cause: renamed });
    assert.equal(
      collectTransportDiagnostic(custom),
      'code=n/a errno=n/a syscall=n/a hasCause=true cause=CustomName causeCode=n/a',
    );

    const garbage = new APIConnectionTimeoutError();
    const spoofed = new TypeError('spoofed');
    spoofed.name = 'not a valid name!!';
    Object.assign(garbage, { cause: spoofed });
    assert.equal(
      collectTransportDiagnostic(garbage),
      'code=n/a errno=n/a syscall=n/a hasCause=true cause=TypeError causeCode=n/a',
    );
  });

  it('handles a cause without a name', () => {
    const root = new APIConnectionTimeoutError();
    Object.assign(root, { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
    assert.equal(
      collectTransportDiagnostic(root),
      'code=UND_ERR_CONNECT_TIMEOUT errno=n/a syscall=n/a ' +
        'hasCause=true cause=n/a causeCode=UND_ERR_CONNECT_TIMEOUT',
    );
  });

  it('treats a null cause as missing', () => {
    const root = new APIConnectionTimeoutError();
    Object.assign(root, { cause: null });
    assert.equal(
      collectTransportDiagnostic(root),
      'code=n/a errno=n/a syscall=n/a hasCause=false cause=n/a causeCode=n/a',
    );
  });
});

describe('UpstreamError transport plumbing', () => {
  it('preserves status, message, and transport', () => {
    const error = new UpstreamError(
      504,
      'AI analysis timed out. Please try again.',
      { transport: 'code=X errno=n/a syscall=n/a hasCause=false cause=n/a causeCode=n/a', durationMs: 30016 },
    );
    assert.equal(error.status, 504);
    assert.equal(error.message, 'AI analysis timed out. Please try again.');
    assert.equal(
      error.transport,
      'code=X errno=n/a syscall=n/a hasCause=false cause=n/a causeCode=n/a',
    );
    assert.equal(error.durationMs, 30016);
  });

  it('leaves transport undefined when not provided', () => {
    const error = new UpstreamError(502, 'AI analysis failed. Please try again.');
    assert.equal(error.transport, undefined);
  });
});
