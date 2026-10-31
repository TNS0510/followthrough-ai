import OpenAI, {
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from 'openai';

const META_BASE_URL = 'https://api.meta.ai/v1';
const MODEL = 'muse-spark-1.3';
const REQUEST_TIMEOUT_MS = 30_000;

export class UpstreamError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
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

function toUpstreamError(error: unknown): UpstreamError {
  if (error instanceof UpstreamError) {
    return error;
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new UpstreamError(
      504,
      'AI analysis timed out. Please try again.',
    );
  }
  if (error instanceof AuthenticationError) {
    return new UpstreamError(
      500,
      'AI service credentials were rejected. Check the server configuration.',
    );
  }
  if (error instanceof RateLimitError) {
    return new UpstreamError(
      503,
      'AI service is busy. Please try again shortly.',
    );
  }
  if (error instanceof APIError) {
    if (error.status === 403) {
      return new UpstreamError(
        500,
        'AI service credentials were rejected. Check the server configuration.',
      );
    }
    if (error.status === 429) {
      return new UpstreamError(
        503,
        'AI service is busy. Please try again shortly.',
      );
    }
    if (error.status === 408 || error.status === 504) {
      return new UpstreamError(
        504,
        'AI analysis timed out. Please try again.',
      );
    }
    return new UpstreamError(502, 'AI analysis failed. Please try again.');
  }
  return new UpstreamError(502, 'AI analysis failed. Please try again.');
}

export async function analyzeEnquiryText(input: string): Promise<unknown> {
  const client = new OpenAI({
    baseURL: META_BASE_URL,
    apiKey: getApiKey(),
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });
  try {
    const response = await client.responses.create({ model: MODEL, input });
    return extractJsonPayload(extractOutputText(response));
  } catch (error) {
    throw toUpstreamError(error);
  }
}
