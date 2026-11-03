import 'dotenv/config';
import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Express, NextFunction, Request, Response } from 'express';
import {
  FollowUpStoreError,
  toFollowUpView,
  validateFollowUpPatch,
  validateNewFollowUp,
} from './followups.js';
import type { FollowUp, FollowUpView } from './followups.js';
import { PostgresFollowUpStore } from './followupStore.js';
import type { FollowUpFilters, FollowUpStore } from './followupStore.js';
import { analyzeEnquiryText, UpstreamError } from './metaClient.js';
import { buildAnalysisInput } from './prompt.js';
import {
  applyCommitmentSafeguard,
  validateAnalysis,
  validateAnalyzeRequest,
} from './validate.js';

const DEFAULT_PORT = 3001;
const BODY_LIMIT = '100kb';
const SERVER_TIMEOUT_MS = 60_000;

function toFollowUpViews(followUps: FollowUp[]): FollowUpView[] {
  const nowMs = Date.now();
  return followUps.map((followUp) => toFollowUpView(followUp, nowMs));
}

function followUpStoreFailure(
  res: Response,
  action: string,
  error: unknown,
): void {
  if (!(error instanceof FollowUpStoreError)) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error(`[api] follow-up ${action} failed: ${detail}`);
  }
  res.status(500).json({
    error: 'Unable to access follow-up storage. Please try again later.',
  });
}

interface BodyParserError extends Error {
  status?: unknown;
  type?: unknown;
}

function defaultClientDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
}

function normalizeIpAddress(value: string): string {
  const ip = value.trim().toLowerCase();
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

function isPrivateAddress(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const ip = normalizeIpAddress(value);
  const family = isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (family === 6) {
    if (ip === '::1') {
      return true;
    }
    const first = Number.parseInt(ip.split(':')[0] ?? '', 16);
    return (
      (first >= 0xfe80 && first <= 0xfebf) ||
      (first >= 0xfc00 && first <= 0xfdff)
    );
  }
  return false;
}

// Client identity for the AI rate limiter. On Render, traffic arrives via
// Cloudflare (which overwrites CF-Connecting-IP on every request) and
// Render's own proxies (append-only X-Forwarded-For with an undocumented,
// variable hop count), so no fixed trust-proxy hop count can identify the
// visitor safely. The CF-Connecting-IP value is honored only when the
// socket peer is a private address (Render internal / loopback); otherwise
// the peer itself is used. X-Forwarded-For is never trusted. Valid IPs are
// grouped with ipKeyGenerator (IPv6 /56) so address rotation cannot
// trivially bypass the limit; IPv4 keys pass through unchanged.
function analyzeClientKey(req: Request): string {
  const peer = req.socket?.remoteAddress;
  const forwarded = req.headers['cf-connecting-ip'];
  const headerValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const candidate = headerValue?.split(',')[0]?.trim();
  if (candidate) {
    const normalized = normalizeIpAddress(candidate);
    if (isIP(normalized) !== 0 && isPrivateAddress(peer)) {
      return ipKeyGenerator(normalized, 56);
    }
  }
  if (peer) {
    const normalizedPeer = normalizeIpAddress(peer);
    if (isIP(normalizedPeer) !== 0) {
      return ipKeyGenerator(normalizedPeer, 56);
    }
    return peer;
  }
  return 'unknown';
}

export function createApp(
  store: FollowUpStore,
  options: { clientDir?: string; enableFollowups?: boolean } = {},
): Express {
  const app = express();

  app.use(express.json({ limit: BODY_LIMIT }));

  app.get('/api/health', (_req: Request, res: Response): void => {
    res.json({ status: 'ok' });
  });

  // Paid upstream protection: 10 requests per IP per minute on the AI
  // endpoint only. Created per app so tests get isolated counters.
  const analyzeLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: analyzeClientKey,
    handler: (_req: Request, res: Response): void => {
      res
        .status(429)
        .json({ error: 'Too many requests. Please try again shortly.' });
    },
  });

  // Global AI budget protection: 100 requests per hour shared by all
  // clients on the AI endpoint only. Created per app so tests get isolated
  // counters. Runs before the per-IP limiter so the per-IP draft-6 headers
  // stay the visible ones; a request must pass both limits to reach the
  // AI handler. The 429 body matches the per-IP limiter so callers cannot
  // tell which limit tripped.
  const analyzeGlobalLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: () => 'global',
    handler: (_req: Request, res: Response): void => {
      res
        .status(429)
        .json({ error: 'Too many requests. Please try again shortly.' });
    },
  });

  app.post(
    '/api/analyze-enquiry',
    analyzeGlobalLimiter,
    analyzeLimiter,
    async (req: Request, res: Response): Promise<void> => {
      const requestCheck = validateAnalyzeRequest(req.body);
      if (requestCheck.ok === false) {
        res.status(400).json({ error: requestCheck.error });
        return;
      }
      try {
        const input = buildAnalysisInput(requestCheck.value);
        const payload = await analyzeEnquiryText(input);
        const analysisCheck = validateAnalysis(payload);
        if (analysisCheck.ok === false) {
          console.error('[api] Meta response failed validation');
          res.status(502).json({ error: 'AI analysis returned invalid data.' });
          return;
        }
        const guarded = applyCommitmentSafeguard(
          analysisCheck.value,
          requestCheck.value,
        );
        if (guarded.draftResponse !== analysisCheck.value.draftResponse) {
          console.error(
            '[api] draft replaced: potential unauthorised commitment detected',
          );
        }
        res.json(guarded);
      } catch (error) {
        if (error instanceof UpstreamError) {
          console.error(`[api] analyze-enquiry failed: HTTP ${error.status}`);
          res.status(error.status).json({ error: error.message });
          return;
        }
        console.error('[api] analyze-enquiry failed: unexpected error');
        res.status(500).json({ error: 'AI analysis failed. Please try again.' });
      }
    },
  );

  // Follow-up CRUD is future-development surface, not part of the public
  // demo (the shipped frontend never calls it), so it stays disabled unless
  // explicitly enabled: set ENABLE_FOLLOWUPS=true in the environment, or pass
  // enableFollowups for a single app (tests use the option, never the env).
  // Disabled requests get the same generic 404 as unknown API routes, before
  // any validation, handler, or database access runs.
  const followupsEnabled =
    options.enableFollowups ?? process.env.ENABLE_FOLLOWUPS === 'true';
  const followupsGate = (
    _req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    if (followupsEnabled) {
      next();
      return;
    }
    res.status(404).json({ error: 'Not found.' });
  };

  app.get(
    '/api/followups',
    followupsGate,
    async (req: Request, res: Response): Promise<void> => {
      const enquiryIdParam = req.query.enquiryId;
      const statusParam = req.query.status;
      if (
        (enquiryIdParam !== undefined && typeof enquiryIdParam !== 'string') ||
        (statusParam !== undefined && typeof statusParam !== 'string')
      ) {
        res.status(400).json({ error: 'Invalid query parameters.' });
        return;
      }
      const enquiryId =
        typeof enquiryIdParam === 'string' ? enquiryIdParam.trim() : '';
      const status = typeof statusParam === 'string' ? statusParam.trim() : '';
      if (status !== '' && status !== 'pending' && status !== 'completed') {
        res
          .status(400)
          .json({ error: "Query parameter status must be 'pending' or 'completed'." });
        return;
      }
      const filters: FollowUpFilters = {};
      if (enquiryId !== '') {
        filters.enquiryId = enquiryId;
      }
      if (status === 'pending' || status === 'completed') {
        filters.status = status;
      }
      let stored: FollowUp[];
      try {
        stored = await store.list(filters);
      } catch (error) {
        followUpStoreFailure(res, 'list', error);
        return;
      }
      res.json({ followUps: toFollowUpViews(stored) });
    },
  );

  app.post(
    '/api/followups',
    followupsGate,
    async (req: Request, res: Response): Promise<void> => {
      const checked = validateNewFollowUp(req.body);
      if (checked.ok === false) {
        res.status(400).json({ error: checked.error });
        return;
      }
      let created: FollowUp;
      try {
        created = await store.create(checked.value);
      } catch (error) {
        followUpStoreFailure(res, 'create', error);
        return;
      }
      res.status(201).json({ followUp: toFollowUpView(created) });
    },
  );

  app.patch(
    '/api/followups/:id',
    followupsGate,
    async (req: Request, res: Response): Promise<void> => {
      const checked = validateFollowUpPatch(req.body);
      if (checked.ok === false) {
        res.status(400).json({ error: checked.error });
        return;
      }
      const id = req.params.id;
      if (typeof id !== 'string') {
        res.status(404).json({ error: 'Follow-up not found.' });
        return;
      }
      let updated: FollowUp | null;
      try {
        updated = await store.update(id, checked.value);
      } catch (error) {
        followUpStoreFailure(res, 'update', error);
        return;
      }
      if (updated === null) {
        res.status(404).json({ error: 'Follow-up not found.' });
        return;
      }
      res.json({ followUp: toFollowUpView(updated) });
    },
  );

  app.use('/api', (_req: Request, res: Response): void => {
    res.status(404).json({ error: 'Not found.' });
  });

  // Production frontend: serve the compiled React app when a build is
  // present. Skipped in development (no dist/) and directed at a fixture
  // dir in tests via options.
  const clientDir = options.clientDir ?? defaultClientDir();
  if (existsSync(join(clientDir, 'index.html'))) {
    console.log(`[server] serving client from ${clientDir}`);
    app.use(express.static(clientDir));
    app.get(
      '/{*splat}',
      (req: Request, res: Response, next: NextFunction): void => {
        if (extname(req.path) !== '') {
          res.sendStatus(404);
          return;
        }
        res.sendFile(
          'index.html',
          { root: clientDir },
          (error?: Error): void => {
            if (error) {
              next(error);
            }
          },
        );
      },
    );
  }

  app.use(
    (
      err: BodyParserError,
      _req: Request,
      res: Response,
      next: NextFunction,
    ): void => {
      if (res.headersSent) {
        next(err);
        return;
      }
      if (err.type === 'entity.too.large') {
        res.status(413).json({ error: 'Request body is too large.' });
        return;
      }
      if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
        res.status(400).json({ error: 'Request body must be valid JSON.' });
        return;
      }
      next(err);
    },
  );

  return app;
}

const app = createApp(new PostgresFollowUpStore());

export default app;

const invokedPath = process.argv[1];
const isMainModule =
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(invokedPath).href;

if (isMainModule) {
  if (!process.env.MODEL_API_KEY) {
    console.error(
      '[server] MODEL_API_KEY is not set. Add it to the server .env file and restart.',
    );
    process.exit(1);
  }

  const port = process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port <= 0) {
    console.error('[server] PORT must be a positive integer.');
    process.exit(1);
  }

  const server = app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`);
  });
  server.timeout = SERVER_TIMEOUT_MS;
}
