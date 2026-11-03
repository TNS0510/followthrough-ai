# FollowThrough AI

FollowThrough AI helps small businesses follow through on customer enquiries:
it analyses an enquiry, suggests the single most useful next action, and drafts
a professional customer reply. It was built for the Meta Global AI Developer
Hackathon as a public demo, and the demo uses **fictional data only**.

## Problem and intended users

Customer enquiries arrive across many channels — email, phone, web forms,
messaging apps — and busy teams miss follow-ups. FollowThrough AI is intended
for small service businesses that want every enquiry triaged with a clear next
step and a ready-to-send draft. The current release is a hackathon
demonstration, not a finished product: there is no user authentication, and the
built-in sample enquiries are fictional.

## Implemented features

- **AI enquiry analysis** (`POST /api/analyze-enquiry`): accepts a customer
  enquiry and returns structured JSON with `missingInfo`, `nextAction`,
  `actionReason`, `draftResponse`, `needsHuman`, and `uncertain`. Responses are
  validated, and a commitment safeguard rewrites drafts that promise anything
  the business has not authorised.
- **Demo frontend**: dashboard, enquiries, drafts, and analyze pages over five
  fictional sample enquiries, with search, status/priority/review filters, and
  client-side review marking. The analyze page sends enquiries to the app's own
  backend and displays the AI result.
- **Rate limiting on the AI endpoint**: 10 requests per IP per minute plus a
  shared global cap of 100 requests per hour, with generic HTTP 429 responses.
- **Health endpoint**: `GET /api/health` returns `{"status":"ok"}` and needs no
  database or AI key.
- **Production serving**: the Express backend serves the built React app with
  SPA fallback, JSON 404s for unknown API routes, a 100 KB JSON body limit,
  and safe generic error responses.
- **Follow-up API (implemented, disabled by default)**: `GET`/`POST`
  `/api/followups` and `PATCH /api/followups/:id` with PostgreSQL storage exist
  for future development, but return a generic 404 unless explicitly enabled
  (see `ENABLE_FOLLOWUPS` below). The shipped frontend does not call them.

## Technology stack

- Frontend: React 19, Vite 8, TypeScript
- Backend: Node.js, Express 5, TypeScript
- AI: Meta API via the OpenAI SDK (`MODEL_API_KEY` stays server-side)
- Storage (optional, follow-ups only): PostgreSQL via the `postgres` client
  (designed for the Supabase session-mode pooler)
- Safety: `express-rate-limit`, `tsx` + `node:test` test suites, ESLint

## Prerequisites

- **Node.js 24.22.1** (pinned by `.node-version`)
- npm (ships with Node.js) and Git
- A Meta API key (`MODEL_API_KEY`) to use AI analysis
- PostgreSQL is **not** needed unless you enable the follow-up endpoints

## Local development

```bash
git clone <your-fork-url>
cd followthrough-ai
npm ci
Copy-Item .env.example .env
# macOS/Linux equivalent: cp .env.example .env
```

Edit `.env` and set at least `MODEL_API_KEY`. Then run the backend and the
frontend dev server in two terminals:

```bash
npm run server   # Express API on http://localhost:3001
npm run dev      # Vite dev server (usually http://localhost:5173, proxies /api)
```

To run the production build locally instead:

```bash
npm run build && npm run build:server
npm start        # serves API + built frontend on http://localhost:3001
```

## Environment variables

All server configuration comes from these variables (see `.env.example`).
`MODEL_API_KEY` is read only by backend code; the frontend bundle contains no
keys and calls only the same-origin `/api/analyze-enquiry` endpoint. **Never
commit `.env`** — it holds secrets. Only `.env.example` (empty values) belongs
in Git.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MODEL_API_KEY` | Yes, for AI analysis | — | Meta API key, server-side only. The server refuses to boot without it. |
| `ENABLE_FOLLOWUPS` | No | `false` | Follow-up CRUD routes stay disabled (generic 404) unless exactly `'true'`. |
| `DATABASE_URL` | Only when follow-ups are enabled | — | PostgreSQL connection string. **Not required** for the public demo while follow-ups are disabled: no request path touches the database. |
| `PORT` | No | `3001` | Port the server listens on. Render provides this automatically. |
| `TEST_DATABASE_URL` | Tests only | — | Separate test database for `npm run test:integration`. Must never point at production or demo data. |
| `TEST_DATABASE_SSL` | Tests only | require SSL | Set to `disable` only for loopback PostgreSQL integration testing. Never for remote databases. |

### Database note (follow-ups enabled only)

The PostgreSQL client uses prepared statements, so when the follow-up
endpoints are enabled the connection **must** use session-mode pooling (for
example the Supabase session pooler URL), not transaction-mode pooling, and
must use SSL. The connection is lazy: it opens on first use, and the server
boots and serves health, AI analysis, and the frontend without it.

## Testing

```bash
npm test                 # offline unit suite (107 tests, 7 suites): no network, DB, or AI key needed
npm run test:integration # live PostgreSQL suite — opt-in only, NOT part of npm test
npm run lint             # ESLint over the whole repo
```

**Warning:** `npm run test:integration` writes to a real database. It requires
`TEST_DATABASE_URL`, refuses to run if that equals `DATABASE_URL`, and must
never point at production or shared demo data. Confirm the test project
independently (for example in the Supabase dashboard) before the first run.

## Builds

```bash
npm run build         # typecheck (tsc -b) + Vite production build into dist/
npm run build:server  # typecheck + compile the backend into dist-server/
npm start             # run the production server (needs both builds above)
```

Both builds are required for deployment: the server serves the frontend from
`dist/` and runs from `dist-server/`. Build outputs are git-ignored.

## Deployment (Render Blueprint)

The repo ships the approved Render configuration: `render.yaml` (single Node.js
Web Service) and `.node-version` (`24.22.1`).

- **Build command**: `npm ci && npm run build && npm run build:server`
- **Start command**: `npm start`
- **Health-check path**: `/api/health`
- `MODEL_API_KEY` is declared with `sync: false`, so Render prompts for the
  secret value in the dashboard at Blueprint creation time — it never appears
  in the repo.
- `ENABLE_FOLLOWUPS` is pinned to `"false"`, keeping follow-up routes disabled.
- `DATABASE_URL` is intentionally absent: the disabled-follow-ups demo needs no
  database. `PORT` is provided automatically by Render; no test variables are
  configured in production.

Typical flow: push the repo to GitHub, then in the Render dashboard create a
new Blueprint from the repository, enter `MODEL_API_KEY` when prompted, and
deploy. No Docker, migration, or extra service is needed.

## Demo limitations

- Fictional sample data only; no real customer information.
- No authentication: the AI endpoint is public and spend is bounded only by the
  100-requests-per-hour global rate limit.
- Rate limits are in-memory: they reset on restart and are per service
  instance.
- Follow-up endpoints are disabled by default; enabling them requires a
  configured session-mode PostgreSQL database with the `follow_ups` schema.
