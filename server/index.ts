import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import {
  createFollowUp,
  defaultStorePath,
  loadFollowUps,
  saveFollowUps,
  toFollowUpView,
  updateFollowUp,
  validateFollowUpPatch,
  validateNewFollowUp,
} from './followups.js';
import type { FollowUp, FollowUpView } from './followups.js';
import { analyzeEnquiryText, UpstreamError } from './metaClient.js';
import { buildAnalysisInput } from './prompt.js';
import {
  applyCommitmentSafeguard,
  validateAnalysis,
  validateAnalyzeRequest,
} from './validate.js';

const app = express();
const DEFAULT_PORT = 3001;
const BODY_LIMIT = '100kb';
const SERVER_TIMEOUT_MS = 60_000;

app.use(express.json({ limit: BODY_LIMIT }));

app.get('/api/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok' });
});

app.post(
  '/api/analyze-enquiry',
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

function followupsStorePath(): string {
  return process.env.FOLLOWUPS_FILE || defaultStorePath();
}

function toFollowUpViews(followUps: FollowUp[]): FollowUpView[] {
  const nowMs = Date.now();
  return followUps.map((followUp) => toFollowUpView(followUp, nowMs));
}

function followUpStoreFailure(
  res: Response,
  action: string,
  error: unknown,
): void {
  const detail = error instanceof Error ? error.message : 'unknown error';
  console.error(`[api] follow-up ${action} failed: ${detail}`);
  res.status(500).json({
    error: 'Unable to access follow-up storage. Please try again later.',
  });
}

app.get('/api/followups', (req: Request, res: Response): void => {
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
  let stored: FollowUp[];
  try {
    stored = loadFollowUps(followupsStorePath());
  } catch (error) {
    followUpStoreFailure(res, 'list', error);
    return;
  }
  const filtered = stored.filter(
    (followUp) =>
      (enquiryId === '' || followUp.enquiryId === enquiryId) &&
      (status === '' || followUp.status === status),
  );
  res.json({ followUps: toFollowUpViews(filtered) });
});

app.post('/api/followups', (req: Request, res: Response): void => {
  const checked = validateNewFollowUp(req.body);
  if (checked.ok === false) {
    res.status(400).json({ error: checked.error });
    return;
  }
  let stored: FollowUp[];
  try {
    stored = loadFollowUps(followupsStorePath());
  } catch (error) {
    followUpStoreFailure(res, 'load', error);
    return;
  }
  const created = createFollowUp(checked.value);
  try {
    saveFollowUps(followupsStorePath(), [...stored, created]);
  } catch (error) {
    followUpStoreFailure(res, 'save', error);
    return;
  }
  res.status(201).json({ followUp: toFollowUpView(created) });
});

app.patch('/api/followups/:id', (req: Request, res: Response): void => {
  const checked = validateFollowUpPatch(req.body);
  if (checked.ok === false) {
    res.status(400).json({ error: checked.error });
    return;
  }
  let stored: FollowUp[];
  try {
    stored = loadFollowUps(followupsStorePath());
  } catch (error) {
    followUpStoreFailure(res, 'load', error);
    return;
  }
  const existing = stored.find((followUp) => followUp.id === req.params.id);
  if (existing === undefined) {
    res.status(404).json({ error: 'Follow-up not found.' });
    return;
  }
  const updated = updateFollowUp(existing, checked.value);
  try {
    saveFollowUps(
      followupsStorePath(),
      stored.map((followUp) =>
        followUp.id === updated.id ? updated : followUp,
      ),
    );
  } catch (error) {
    followUpStoreFailure(res, 'save', error);
    return;
  }
  res.json({ followUp: toFollowUpView(updated) });
});

app.use('/api', (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Not found.' });
});

interface BodyParserError extends Error {
  status?: unknown;
  type?: unknown;
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
