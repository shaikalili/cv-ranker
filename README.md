# CV Ranker

An AI-powered CV ranking system that extracts weighted requirements from a job description, scores candidate resumes through a two-stage keyword + LLM pipeline, and explains every decision with direct quotes from the CV.

Built for a job-interview home assignment. Optimized for **cost, explainability, bias mitigation, and reliability** — not for scale. See [Out of Scope](#out-of-scope) and [Scaling & Production Hardening](#scaling--production-hardening) for what was deliberately left out.

---

## Table of Contents

1. [What the App Does](#what-the-app-does)
2. [How to Run](#how-to-run)
3. [Architecture](#architecture)
4. [The Services](#the-services)
5. [Pipeline Walkthrough](#pipeline-walkthrough)
6. [Tech Stack](#tech-stack)
7. [Progress Tracking & Reliability](#progress-tracking--reliability)
8. [Inspecting the Database](#inspecting-the-database)
9. [Out of Scope](#out-of-scope)
10. [Scaling & Production Hardening](#scaling--production-hardening)

---

## What the App Does

An HR-facing dashboard for ranking resumes against a job position.

**The user flow in four steps:**

1. **Create a job position** — paste a job description, give it a title. The backend asynchronously calls OpenAI to extract a list of *weighted, typed requirements* (technology / experience / education / soft-skill) that HR can edit.
2. **Add CVs** — either upload real PDF/DOCX files, or let the app **AI-generate synthetic CVs** aligned with the extracted requirements (great for demos).
3. **Watch the pipeline run** — anonymize → keyword-filter → AI-score → rank. Progress is surfaced live on the dashboard.
4. **Review rankings** — great / good / no-match tiers, each CV with numerical scores, AI reasoning, direct quote evidence, and a manual tier-override for HR.

**Key product features:**

- Multi-format CV parsing — PDF, DOCX, DOC, with OCR fallback for image-based PDFs
- AI-driven requirement extraction from any job description
- Synthetic CV generation via GPT, aligned with the job's actual requirements
- Bias mitigation — PII is stripped from every CV before scoring runs
- Two-stage scoring — keyword filter eliminates ~70% before any LLM call
- Explainability — per-requirement score, reasoning, and evidence for every CV
- DB-backed polling + SSE streaming for live progress that survives restarts
- HR tier override — any CV can be manually re-bucketed
- JWT + bcrypt auth with a pre-seeded demo account

---

## How to Run

### With Docker (recommended)

The fastest path — one command brings up Postgres, backend, and frontend together.

**Prerequisites:**
- [Docker Desktop](https://www.docker.com/products/docker-desktop)
- An [OpenAI API key](https://platform.openai.com/api-keys)

**Three-step setup:**

```bash
# 1. Clone
git clone <your-repo-url>
cd cv-ranker

# 2. Create your .env from the template
cp .env.example .env
# Open .env and set at minimum:
#   OPENAI_API_KEY="sk-..."
#   JWT_SECRET="<any 32+ char random string>"

# 3. Start everything
docker-compose up --build
```

First build takes ~2 minutes; subsequent starts are a few seconds.

**Three containers come up:**

| Container | What it does | Exposed on |
|---|---|---|
| `cv-ranker-db` | Postgres 16 + named volume for persistence | `localhost:5433` |
| `cv-ranker-backend` | NestJS API, runs Prisma migrations + seed on boot | `localhost:3000/api` |
| `cv-ranker-frontend` | Vite dev server with hot-reload | `localhost:5173` |

**Log in with the seeded demo account:**

- **Email:** `demo@demo.com`
- **Password:** `demo123`

**No real CVs?** Open any job position, go to *Upload CVs* → *Generate CVs*, and the backend will have GPT write synthetic resumes targeting that job's requirements and ingest them directly into the pipeline.

### Without Docker

You'll need Postgres 14+ and Node 20+.

```bash
# Option 1: borrow just the Postgres container and run the rest on the host
docker-compose up postgres -d

# Or Option 2: point DATABASE_URL in backend/.env at your own Postgres

cd backend
cp ../.env.example .env
# In backend/.env, set:
#   DATABASE_URL="postgresql://cvranker:cvranker@localhost:5433/cvranker?schema=public"
npm install
npm run db:migrate
npm run db:seed
npm run start:dev

# In another terminal:
cd frontend
npm install
npm run dev
```

### Restarting after code changes

Hot-reload is enabled for both services — `docker-compose up` alone handles backend TypeScript changes and frontend Vite HMR. Only restart the container when you change Docker or env config:

```bash
docker-compose restart backend   # picks up .env changes
docker-compose up --build        # picks up Dockerfile changes
```

### Running tests

```bash
docker-compose exec backend npm run test
docker-compose exec backend npm run test:cov
docker-compose exec backend npm run test:e2e
```

---

## Architecture

A conventional three-tier app with one twist: a durable async pipeline driven by the database instead of a job queue.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend (React + Vite)                     │
│   Login  ·  New Job Position  ·  Dashboard  ·  Upload CVs        │
└───────────────┬─────────────────────────────────────────────────┘
                │  HTTP (JSON, multipart)  +  SSE  +  2s polling
┌───────────────▼─────────────────────────────────────────────────┐
│                       Backend (NestJS)                           │
│                                                                  │
│  Auth  ──►  Users  ──►  JobDescription  ──►  JobPosition         │
│                               │                 │   (orchestrator)│
│                               │                 │                 │
│                               ▼                 ▼                 │
│                             Ai ──►   Parser → Anonymization →    │
│                                       Filter → Ai (scoring) →    │
│                                       Scoring → Resume           │
│                                                                  │
│                             CvGenerator (LLM-authored CVs)       │
└───────────────┬─────────────────────────────────────────────────┘
                │
        ┌───────▼────────┐
        │   Postgres 16  │  ← single source of truth for progress + data
        │ (Docker volume)│
        └────────────────┘
```

**Design principles:**

1. **DB as source of truth** — every pipeline transition writes `currentStage` to Postgres. SSE and in-memory subjects are speed-ups, never the only path.
2. **Single Responsibility Per Service** — orchestration (`JobPositionService`), persistence (`ResumeService`, `JobDescriptionService`), and AI calls (`AiService`) are separate. `JobPositionService` is a thin coordinator that never touches `prisma.cV.*`.
3. **Fail loud, recover quiet** — a startup sweeper flips any `PROCESSING` / `EXTRACTING_REQUIREMENTS` row older than 15 minutes to `FAILED` so the UI never shows a permanent spinner after a crash.
4. **Cost-first pipeline** — the cheap keyword filter runs before any LLM call to eliminate ~70% of CVs. GPT-5 Mini does the bulk; GPT-5.1 is reserved for the top few.

---

## The Services

The backend is eleven focused modules. Here's what each one owns and why it exists separately.

### `auth/` — JWT authentication

Login, register, JWT strategy, `@CurrentUser()` decorator, and the `JwtAuthGuard` applied to every protected route. Passwords hashed with bcrypt; tokens signed with `JWT_SECRET` from env, 7-day expiry by default.

### `users/` — User account management

A thin module around the `User` table. Exposes `GET /users/me`. Kept separate from `auth/` so credential logic and profile logic don't leak into each other.

### `job-description/` — Job position lifecycle

Owns the `JobPosition` row and its status machine:

```
CREATED → EXTRACTING_REQUIREMENTS → REQUIREMENTS_EXTRACTED → PROCESSING → COMPLETED
                                 ↘                        ↘             ↘
                                            FAILED ← ← ← ← ← ← ← ← ← ← ←
```

Responsibilities:
- Insert + delete job positions (`createJobPosition`, `delete`)
- Run the async AI requirement extraction (`extractRequirements`) — idempotent, safe to retry
- Write status transitions and the `currentStage` column throughout the CV pipeline
- **Startup sweeper** — on boot, marks orphan `PROCESSING` / `EXTRACTING_REQUIREMENTS` rows as `FAILED`

Controller exposes: create, list, get, update-requirements, delete, and the async `POST /:id/extract-requirements` (returns 202).

### `resume/` — CV persistence

Owns all `prisma.cV.*` reads and writes. This used to live inside `JobPositionService`, but was extracted so the orchestrator could stay persistence-free. Includes:

- Batch-insert parsed CVs (`createManyParsed`)
- Write keyword-filter results, AI scores, final tiers
- Manual tier override with automatic per-position tier re-count
- `listByJobPositionRanked` — returns CVs bucketed into great / good / no-match

### `parser/` — Multi-format text extraction

Turns binary CVs into the canonical `ParsedCV` shape:

```
rawText  +  sections  +  sentences  +  entities  +  parsingConfidence
```

- **PDF** — `pdf-parse` first, then `pdfjs-dist`, then `tesseract.js` (OCR) as the last resort for image-based PDFs
- **DOCX** — `mammoth`
- **DOC** — `textract` (legacy Word format)
- **Section detection** — regex-based matching of headers (Summary / Experience / Skills / Education) so downstream stages can target relevant prose
- **Entity extraction** — years of experience, technologies mentioned, degrees, companies, roles
- **Confidence** — `high` / `medium` / `low` / `failed`; `failed` CVs surface a human-readable error in the UI

### `anonymization/` — Bias mitigation

Runs between parsing and scoring. Strips PII from CV text **before** any LLM call:

- Names, emails, phones, addresses, photo references
- Gender pronouns, age / date-of-birth mentions
- The original candidate identity stays in the DB but never reaches GPT

Keeping this in its own module makes the intent (and the testability) explicit — you can run it standalone in a unit test without pulling in parsing or scoring.

### `filter/` — Keyword pre-scoring (the ~70% eliminator)

Stage-1 scoring, no AI involved. For each requirement, it:

1. Builds a "needles" list from `keywords + synonyms`, normalized (lowercase, hyphens-to-spaces, whitespace collapsed).
2. Scans every CV sentence for a needle with **word-boundary matching** (hand-rolled via `indexOf` to avoid regex-escaping user strings like `c++` or `.net`).
3. Maps match count → a coarse score of `0`, `0.6`, or `1.0`.
4. Computes a weighted average across all requirements and assigns a preliminary tier.

Uses permissive thresholds (`great ≥ 70`, `good ≥ 40`, eliminate on 5+ missing required) because this stage optimizes for **recall** — false positives get corrected by the AI stage; false negatives are lost candidates.

### `ai/` — OpenAI integration

The only module that talks to OpenAI. Three prompts:

- **Extract requirements** — job description text → typed, weighted `Requirement[]`
- **Score a CV** — anonymized CV + requirements + keyword-match evidence → per-requirement 0-1 score, reasoning, evidence quote, overall summary
- **Generate a CV** — job title + requirements + target tier (`strong` / `partial` / `weak`) → structured CV content the generator then renders to PDF/DOCX

**Cost controls:**
- Good-tier CVs go to **GPT-5 Mini** (~$0.25 / $2 per 1M tokens)
- Great-tier CVs go to **GPT-5.1** (reserved for the top)
- Concurrency capped via `p-limit` (default `AI_CONCURRENCY_LIMIT=5`)
- Exponential-backoff retry on transient OpenAI errors
- Per-call cost reported in logs and written to `JobPosition.aiCostUsd`

### `scoring/` — Final scoring + ranking

Takes filter results + AI scores and produces the final tier assignment. Uses the **same** `weightedScore` / `assignTier` / `countMissingRequired` helpers as `filter/` — the math is identical, only the thresholds and the "what counts as missing" predicate differ. This sharing is what guarantees the two stages can't semantically diverge.

### `job-position/` — Pipeline orchestrator

The conductor. Owns `POST /job-positions/:id/cvs`, `POST /:id/rescore`, `POST /:id/generate-cvs`, plus the SSE and progress endpoints. Its `runPipeline` method is the end-to-end flow:

```
parse files  →  anonymize  →  save to DB  →  filter  →  AI score  →  final rank
      │             │              │             │           │             │
      └──── writes `currentStage` to DB at every transition ───────────────┘
```

Deliberately contains **zero** `prisma.*` calls for CV data — everything goes through `ResumeService` or `JobDescriptionService`. Also owns the progress pub/sub infrastructure (`ReplaySubject` + heartbeat + DB seed) used by the SSE endpoint.

### `cv-generator/` — Synthetic CV generation

A demo/testing tool. Generates LLM-authored CVs aligned with a job's extracted requirements:

- Builds a tier array from the requested mix (`strong: 30% / partial: 40% / weak: 30%`)
- For each slot, calls `aiService.generateCvContent({ jobTitle, tier, requirements })`
- Gets back structured content (name, summary, experience bullets, skills, education)
- Renders to PDF via `pdfkit` or DOCX via `docx`
- Fires back into `processCVs` as if the user had uploaded the files manually

Concurrency-capped via `CV_GENERATION_CONCURRENCY_LIMIT`. Individual failures return `null` so a batch of 10 can still return 9 successful CVs instead of blowing up entirely.

### `common/` — Shared plumbing

Prisma client, `ParsedCV` / `Requirement` / `CVTier` types, the shared `scoring.util.ts` (`weightedScore`, `assignTier`, `countMissingRequired`), structured logging helpers (`jobLogger`, `startOp`), and global validation / exception filters.

---

## Pipeline Walkthrough

Following one CV from upload to tier:

```
1. POST /job-positions
   └─ JobDescriptionService inserts row, status=CREATED
   └─ Returns immediately (~50ms)

2. POST /:id/extract-requirements   (returns 202)
   └─ status: CREATED → EXTRACTING_REQUIREMENTS
   └─ AiService.extractRequirements(jd) → GPT call → Requirement[]
   └─ status: EXTRACTING_REQUIREMENTS → REQUIREMENTS_EXTRACTED
   └─ Frontend polls and shows "Ready"

3. POST /:id/cvs  (multipart upload, N files)
   └─ status: REQUIREMENTS_EXTRACTED → PROCESSING
   └─ runPipeline starts async; client gets { queued: N }

   Inside runPipeline:
      currentStage='parsing'    → ParserService.parseMany(files)
      currentStage='parsing'    → AnonymizationService.strip(cv)
                                → ResumeService.createManyParsed(parsed)
      currentStage='filtering'  → FilterService.filter(cv, requirements)
                                → ResumeService.writeFilterResult(cvId, ...)
      currentStage='scoring'    → AiService.scoreBatch(cvs) [concurrency-limited]
                                → ScoringService.finalize(cv)
                                → ResumeService.writeFinalScore(cvId, ...)
      currentStage='completed'  → JobDescriptionService.completeProcessing(summary)
      status: PROCESSING → COMPLETED
```

The frontend polls `GET /:id/progress` every 2s during PROCESSING and shows the current stage label. When it sees COMPLETED or FAILED, it refetches the heavy `/results` endpoint once to populate the CV table.

---

## Tech Stack

**Backend**
- NestJS 11 + TypeScript
- Postgres 16 + Prisma 5 ORM
- nestjs-pino for structured logging
- JWT (`@nestjs/jwt`) + bcrypt
- OpenAI SDK (GPT-5 Mini / 5.1)
- `pdf-parse` / `pdfjs-dist` / `tesseract.js` / `mammoth` / `textract` for parsing
- `pdfkit` / `docx` for synthetic CV rendering
- `p-limit` for concurrency control
- RxJS `ReplaySubject` for SSE
- Jest for unit + e2e tests

**Frontend**
- React 18 + Vite + TypeScript
- TailwindCSS (custom near-black brand palette)
- TanStack React Query for server state + polling
- Axios for HTTP
- React Router v6
- `react-dropzone` for uploads
- `lucide-react` icons

**Infrastructure**
- Docker Compose (3 services)
- Anonymous `node_modules` volume so host installs don't collide with container installs
- Named Postgres volume (`postgres_data`) for data persistence

---

## Progress Tracking & Reliability

The ranking pipeline can take anywhere from seconds to minutes depending on CV count and OpenAI latency. To keep the UI responsive without becoming fragile, progress is tracked along **two parallel paths**.

### The design — "DB is the source of truth, SSE is a speed-up"

1. **Database (durable)** — the `job_positions.currentStage` column holds the coarse pipeline phase (`generating` → `parsing` → `filtering` → `scoring` → `completed` / `failed`). Updated at every stage transition. This is what every client ultimately trusts.
2. **SSE stream (optional live channel)** — `GET /api/job-positions/:id/progress/stream` pushes per-CV events via an in-memory `ReplaySubject(1)`. Seeded from the DB on every connect, replays the last event on reconnect, emits a heartbeat every 15s so idle proxies don't close the socket.
3. **Poll endpoint** — `GET /api/job-positions/:id/progress` returns a slim JSON snapshot (`status`, `currentStage`, `processedCvs`, `totalCvs`). Cheap enough to poll at scale; works across backend restarts.
4. **Startup sweeper** — on boot, `JobDescriptionService` marks any row stuck in `PROCESSING` or `EXTRACTING_REQUIREMENTS` for over 15 minutes as `FAILED`.

### What this design resolves

| Failure mode | How it's handled |
|---|---|
| Client closes the tab mid-run | Pipeline keeps running server-side; DB is updated to completion; user sees final state on next load. |
| Client reconnects on flaky Wi-Fi | `ReplaySubject(1)` replays the last event; SSE seed query returns current stage from DB. |
| Proxy kills an idle SSE connection | 15-second heartbeat keeps the socket active during long silent stretches. |
| Backend crashes mid-pipeline | Startup sweeper flips stale rows to `FAILED` so the UI never shows a permanent spinner. |
| User opens the page after the run finished | DB-backed `/progress` endpoint returns final state immediately — no in-memory dependency. |
| Heavy `/results` payload during polling | Dashboard polls slim `/progress` (~100 bytes) every 2s; only fetches `/results` once on completion. |

### Why not a queue today?

A durable queue (BullMQ on Redis, or pg-boss on Postgres) is the architecturally correct answer to everything in the [Scaling & Production Hardening](#scaling--production-hardening) table, but it doubles the deploy surface: another container, another dependency, a split between API and worker. For a single-instance app with in-memory orchestration, the DB-as-source-of-truth approach resolves ~70% of the failure modes with ~5% of the complexity — and leaves a clean migration path.

---

## Inspecting the Database

Two options for browsing Postgres while the stack runs.

### Prisma Studio (GUI, recommended)

```bash
cd backend
npx prisma studio
```

Opens at http://localhost:5555 with browsable, filterable, inline-editable tables.

**Prerequisites:**
- `backend/.env` must contain `DATABASE_URL="postgresql://cvranker:cvranker@localhost:5433/cvranker?schema=public"`. Note the host-side port is **5433** (mapped from container's 5432 to avoid colliding with a local Postgres install).
- Don't also set `$env:DATABASE_URL` in your shell — dotenv won't override a shell-level var. If you hit "authentication failed", open a fresh terminal and retry.

### psql inside the container

```bash
docker-compose exec postgres psql -U cvranker -d cvranker
```

Useful queries:
```sql
\dt                                              -- list tables
SELECT title, status, "currentStage" FROM job_positions;
SELECT "originalFilename", tier, "finalScore"
  FROM cvs ORDER BY "finalScore" DESC NULLS LAST LIMIT 10;
\q
```

---

## Out of Scope

Explicitly **not** built for this assignment. Each one has a defensible reason it was skipped, but would be table-stakes for production.

| Excluded | Rationale |
|---|---|
| **Multi-tenant / org accounts** | Single-user assumption. One demo account + personal job positions. No organization table, no role-based access, no sharing. |
| **Password reset / email verification** | JWT auth with a seeded demo account is enough for a take-home. No SMTP configured. |
| **Durable job queue (BullMQ, pg-boss)** | In-process orchestration with DB-backed progress was a conscious trade-off — see [Why not a queue today](#why-not-a-queue-today). |
| **Horizontal scaling of backend** | Single-replica. The `ReplaySubject` lives in one Node process; a second pod wouldn't see the stream. DB-polling would still work cross-instance. |
| **Cancellation of a running pipeline** | No `AbortController` threaded through. A 500-CV batch started by mistake runs to completion and burns OpenAI budget. |
| **Rate limiting / abuse protection** | No `@nestjs/throttler`, no IP bans, no quotas. Demo UX assumes a trusted single user. |
| **Observability stack** | Pino writes structured JSON to stdout; no Prometheus metrics, no OpenTelemetry traces, no Sentry wiring. |
| **E2E test coverage parity with unit tests** | Unit tests cover the scoring math, filter boundaries, anonymization. E2E tests exist for auth + job creation but don't exhaustively cover the pipeline. |
| **File storage beyond the DB** | CV raw text is stored in Postgres `TEXT` columns. No S3 / blob storage for the original binaries. Fine for thousands of CVs, not millions. |
| **Vector embeddings / semantic search** | Current matching is keyword + synonyms + AI. Real semantic similarity (e.g. "scaled reliability eng" ↔ "SRE" without an explicit synonym) would need a `pgvector` column and an embedding pass. |
| **Multi-language support** | Hebrew, French, etc. parse fine in the sense of "text extracted" — but all prompts and stop-word lists are English-only. |
| **ATS integration** | No Greenhouse / Lever / Workable webhooks. |
| **Audit log** | No change history on requirement edits or tier overrides. |

---

