import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from 'openai';

const META_BASE_URL = 'https://api.meta.ai/v1';
const MODEL = 'muse-spark-1.3';
const REQUEST_TIMEOUT_MS = 30_000;

export interface UpstreamErrorDiagnostics {
  readonly upstreamStatus?: number;
  readonly errorName?: string;
  readonly requestId?: string;
  readonly durationMs?: number;
  readonly transport?: string;
  readonly cause?: unknown;
}

export class UpstreamError extends Error {
  readonly status: number;
  readonly upstreamStatus?: number;
  readonly errorName?: string;
  readonly requestId?: string;
  readonly durationMs?: number;
  readonly transport?: string;

  constructor(
    status: number,
    message: string,
    diagnostics: UpstreamErrorDiagnostics = {},
  ) {
    super(message, { cause: diagnostics.cause });
    this.name = 'UpstreamError';
    this.status = status;
    this.upstreamStatus = diagnostics.upstreamStatus;
    this.errorName = diagnostics.errorName;
    this.requestId = diagnostics.requestId;
    this.durationMs = diagnostics.durationMs;
    this.transport = diagnostics.transport;
  }
}

const MAX_REQUEST_ID_LENGTH = 128;

function sanitizeErrorName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '' || !/^[A-Za-z0-9_]{1,64}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function sanitizeRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }
  const singleLine = trimmed.replace(/\s+/g, '');
  if (!/^[\x21-\x7E]{1,128}$/.test(singleLine)) {
    return undefined;
  }
  return singleLine.slice(0, MAX_REQUEST_ID_LENGTH);
}

// Connection-failure diagnostics. Only allowlisted transport fields are ever
// read (code, errno, syscall, cause presence/name/code). Messages, hostnames,
// headers, bodies, and keys are never read, so they cannot leak into logs.
const MAX_CAUSE_DEPTH = 3;

function sanitizeTransportCode(value: unknown): string | undefined {
  if (typeof value === 'number') {
    // Numeric codes come from DOMException (legacy range 1-25). Accept only
    // small non-negative integers.
    if (!Number.isSafeInteger(value) || value < 0 || value > 9999) {
      return undefined;
    }
    return String(value);
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '' || !/^[A-Za-z0-9_.-]{1,64}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function sanitizeSyscall(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '' || !/^[A-Za-z0-9_]{1,32}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function sanitizeErrno(value: unknown): string | undefined {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Math.abs(value) > 999999) {
      return undefined;
    }
    return String(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || !/^[A-Za-z0-9_.-]{1,16}$/.test(trimmed)) {
      return undefined;
    }
    return trimmed;
  }
  return undefined;
}

function readField(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function readCause(value: object): unknown {
  try {
    return (value as { cause?: unknown }).cause;
  } catch {
    return undefined;
  }
}

// Follows the cause chain with a depth bound and cycle guard. Returns the
// visited objects starting with the top-level error.
function collectCauseChain(error: object): object[] {
  const chain: object[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (
    typeof current === 'object' &&
    current !== null &&
    chain.length <= MAX_CAUSE_DEPTH &&
    !seen.has(current)
  ) {
    seen.add(current);
    chain.push(current);
    const cause = readCause(current);
    if (typeof cause !== 'object' || cause === null) {
      break;
    }
    current = cause;
  }
  return chain;
}

function firstInChain(
  chain: object[],
  start: number,
  sanitize: (value: unknown) => string | undefined,
  key: string,
): string | undefined {
  for (let index = start; index < chain.length; index += 1) {
    const value = sanitize(readField(chain[index] as object, key));
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

// Builds the log-ready transport fragment for API connection failures, or
// undefined for anything else. Never throws: diagnostics must not break
// error handling.
export function collectTransportDiagnostic(error: unknown): string | undefined {
  if (!(error instanceof APIConnectionError)) {
    return undefined;
  }
  try {
    const chain = collectCauseChain(error);
    const cause = readCause(error);
    const hasCause = cause !== undefined && cause !== null;
    // Prefer the cause's own name: a DOMException reports AbortError here
    // while its constructor is just DOMException. Falls back to the
    // constructor name. Both pass through the same allowlist.
    const causeName =
      cause instanceof Error
        ? (sanitizeErrorName(readField(cause, 'name')) ??
          sanitizeErrorName(cause.constructor.name))
        : undefined;
    const code = firstInChain(chain, 0, sanitizeTransportCode, 'code');
    const errno = firstInChain(chain, 0, sanitizeErrno, 'errno');
    const syscall = firstInChain(chain, 0, sanitizeSyscall, 'syscall');
    const causeCode = firstInChain(chain, 1, sanitizeTransportCode, 'code');
    return (
      `code=${code ?? 'n/a'} errno=${errno ?? 'n/a'} ` +
      `syscall=${syscall ?? 'n/a'} hasCause=${hasCause} ` +
      `cause=${causeName ?? 'n/a'} causeCode=${causeCode ?? 'n/a'}`
    );
  } catch {
    return undefined;
  }
}

function collectDiagnostics(
  error: unknown,
  durationMs: number,
): UpstreamErrorDiagnostics {
  const errorName =
    error instanceof Error
      ? sanitizeErrorName(error.constructor.name)
      : undefined;
  const upstreamStatus =
    error instanceof APIError &&
    typeof error.status === 'number' &&
    Number.isInteger(error.status)
      ? error.status
      : undefined;
  const requestId =
    error instanceof APIError
      ? sanitizeRequestId(error.requestID)
      : undefined;
  return {
    upstreamStatus,
    errorName,
    requestId,
    durationMs,
    transport: collectTransportDiagnostic(error),
    cause: error,
  };
}

function getApiKey(): string {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) {
    throw new UpstreamError(
      500,
      'AI service is not configured. Set MODEL_API_KEY in the server environment.',
    );
  }
  return apiKey;
}

function extractOutputText(response: unknown): string {
  if (typeof response !== 'object' || response === null) {
    return '';
  }
  const record = response as Record<string, unknown>;
  if (
    typeof record.output_text === 'string' &&
    record.output_text !== ''
  ) {
    return record.output_text;
  }
  if (!Array.isArray(record.output)) {
    return '';
  }
  const parts: string[] = [];
  for (const item of record.output) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const message = item as Record<string, unknown>;
    if (message.type !== 'message' || !Array.isArray(message.content)) {
      continue;
    }
    for (const entry of message.content) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }
      const content = entry as Record<string, unknown>;
      if (
        content.type === 'output_text' &&
        typeof content.text === 'string'
      ) {
        parts.push(content.text);
      }
    }
  }
  return parts.join('');
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new UpstreamError(502, 'AI analysis returned an empty response.');
  }
  const direct = tryParseJson(trimmed);
  if (direct !== undefined) {
    return direct;
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = tryParseJson(trimmed.slice(start, end + 1));
    if (sliced !== undefined) {
      return sliced;
    }
  }
  throw new UpstreamError(502, 'AI analysis returned malformed data.');
}

function toUpstreamError(error: unknown, durationMs: number): UpstreamError {
  if (error instanceof UpstreamError) {
    if (error.durationMs !== undefined) {
      return error;
    }
    return new UpstreamError(error.status, error.message, {
      upstreamStatus: error.upstreamStatus,
      errorName: error.errorName ?? 'UpstreamError',
      requestId: error.requestId,
      durationMs,
      transport: error.transport,
      cause: error.cause ?? error,
    });
  }
  const diagnostics = collectDiagnostics(error, durationMs);
  if (error instanceof APIConnectionTimeoutError) {
    return new UpstreamError(
      504,
      'AI analysis timed out. Please try again.',
      diagnostics,
    );
  }
  if (error instanceof AuthenticationError) {
    return new UpstreamError(
      500,
      'AI service credentials were rejected. Check the server configuration.',
      diagnostics,
    );
  }
  if (error instanceof RateLimitError) {
    return new UpstreamError(
      503,
      'AI service is busy. Please try again shortly.',
      diagnostics,
    );
  }
  if (error instanceof APIError) {
    if (error.status === 403) {
      return new UpstreamError(
        500,
        'AI service credentials were rejected. Check the server configuration.',
        diagnostics,
      );
    }
    if (error.status === 429) {
      return new UpstreamError(
        503,
        'AI service is busy. Please try again shortly.',
        diagnostics,
      );
    }
    if (error.status === 408 || error.status === 504) {
      return new UpstreamError(
        504,
        'AI analysis timed out. Please try again.',
        diagnostics,
      );
    }
    return new UpstreamError(
      502,
      'AI analysis failed. Please try again.',
      diagnostics,
    );
  }
  return new UpstreamError(
    502,
    'AI analysis failed. Please try again.',
    diagnostics,
  );
}

export async function analyzeEnquiryText(input: string): Promise<unknown> {
  const start = Date.now();
  let client: OpenAI;
  try {
    client = new OpenAI({
      baseURL: META_BASE_URL,
      apiKey: getApiKey(),
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
  } catch (error) {
    throw toUpstreamError(error, Date.now() - start);
  }
  try {
    const response = await client.responses.create({ model: MODEL, input });
    return extractJsonPayload(extractOutputText(response));
  } catch (error) {
    throw toUpstreamError(error, Date.now() - start);
  }
}
