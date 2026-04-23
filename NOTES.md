# 🛠 Known Issues & Fixes Needed

This file is the running source-of-truth for issues in the scaffolded code.
Items get crossed out as they're resolved, new ones get added as they're found.

---

## ✅ Recently resolved

### Fixed CommonJS star-imports (22 Apr 2026)
Replaced `import * as X from '...'` with default imports in all three
places. Required because these packages ship a single callable/class as
`module.exports`, which `* as` namespace-wraps into a non-callable object
under `esModuleInterop`.

- `backend/src/parser/parsers/pdf.parser.ts` — `pdfParse`
- `backend/src/cv-generator/cv-generator.service.ts` — `PDFDocument`
- `backend/src/cv-generator/cv-generator.controller.ts` — `archiver`

### Added Prisma seed config (22 Apr 2026)
`backend/package.json` now declares:
```json
"prisma": { "seed": "ts-node prisma/seed.ts" }
```
so `npx prisma db seed` (invoked by the backend container's startup
command) can find and run the seed script. Without this, `docker-compose up`
would fail on first boot with *"No seed command has been defined"*.

### Switched from Neon to Postgres-in-Docker (22 Apr 2026)
- Added `postgres:16-alpine` service to `docker-compose.yml` with a named
  `postgres_data` volume and a healthcheck.
- Backend `depends_on: postgres` with `condition: service_healthy`, so
  `prisma migrate deploy` only runs once the DB is actually accepting
  connections.
- `DATABASE_URL` is hardcoded to the compose-internal DSN inside the backend
  service env, so the reviewer does not need to configure a database at all.
- Root `.env.example` now only requires `OPENAI_API_KEY` + `JWT_SECRET`.
- `backend/.env.example` kept for standalone-dev usage, with a local
  Postgres DSN instead of the Neon one.
- README setup steps simplified: clone, add OpenAI key, `docker-compose up --build`.

### OpenAI model names (verified 22 Apr 2026)
Original concern: `gpt-5-mini` and `gpt-5.1` may not be valid strings.
Verdict: **Both model IDs are live and callable on the OpenAI API as of
April 2026.** Pricing table in `backend/src/ai/ai.service.ts:219-223` matches
published rates ($0.25 / $2.00 for `gpt-5-mini`, $1.25 / $10.00 for
`gpt-5.1`). No change required.

OpenAI has since released a newer `gpt-5.4` family (`gpt-5.4-mini` /
`gpt-5.4`), ~3× more expensive per token. Tracked as an optional upgrade in
Priority 3 below.

### Renamed Session → JobPosition (22 Apr 2026)
Renamed the orchestrating entity across the stack so the domain language
matches what the app actually represents: a job opening, not an HTTP session.

- **Prisma:** `model Session` → `model JobPosition`, table `sessions` →
  `job_positions`, enum `SessionStatus` → `JobPositionStatus`, `CV.sessionId`
  → `CV.jobPositionId`.
- **Backend:** `backend/src/session/` → `backend/src/job-position/`, classes
  `SessionModule/Service/Controller` → `JobPosition*`. `JobDescriptionService`
  now creates `JobPosition` records. All API routes changed from
  `/api/sessions/...` to `/api/job-positions/...`.
- **Frontend:** `sessionsApi` → `jobPositionsApi`, `NewSession.tsx` →
  `NewJobPosition.tsx`, types `Session` → `JobPosition`, router paths
  `/sessions/new` → `/job-positions/new` and `/sessions/:sessionId/results`
  → `/job-positions/:jobPositionId/results`, `ResultsResponse.session` →
  `ResultsResponse.jobPosition`.
- **Schema migration:** no data to preserve yet, so the next
  `docker-compose up --build` will create the new schema from scratch. If
  you've already booted once, delete the `postgres_data` volume:
  `docker-compose down -v`.

---

## 🚨 Priority 1 — Must fix before running

### 1. Install dependencies and generate Prisma client
```bash
cd backend
npm install
npx prisma generate
```
(Handled automatically by `docker-compose up --build` via the backend
Dockerfile — this item only matters for standalone dev.)

### 2. Run Prisma migration on first boot
Inside Docker this is handled by the backend's `command:` which runs
`npx prisma migrate deploy`. For standalone dev:
```bash
npx prisma migrate dev --name init
```

---

## ⚠️ Priority 2 — Fix when they surface

### 5. Multer file type typing
**File:** `backend/src/job-position/job-position.service.ts:20-24`
Custom `UploadedFile` interface duplicates Multer's own type. Fields match at
runtime so uploads work, but switching to `Express.Multer.File` would give
better IDE support.

### 6. Tesseract.js in Docker
**File:** `backend/Dockerfile`
Tesseract downloads `eng.traineddata` on first OCR call. Works because the
container has network egress, but adds a few seconds of latency to the first
image-based PDF. Pre-downloading during image build would be cleaner.

### 7. pdf-parse worker files
`pdf-parse`'s index.js has a well-known bug: when `module.parent` is null
it attempts to read a test fixture and throws ENOENT. Doesn't fire in normal
Nest startup but can bite in Jest runs — workaround is to import from
`pdf-parse/lib/pdf-parse.js` directly.

### 8. Verify all DTOs validate correctly
Run the backend and hit each endpoint with invalid data to make sure
`ValidationPipe` catches what it should.

### 9. Potential PII leak in AI scoring (NEW — audit needed)
**File:** `backend/src/job-position/job-position.service.ts:212-218`
`scoreItems` passes `cv: cv.parsed` (the full `ParsedCV`) into the AI
scorer. `ParsedCV` contains `rawText`, `sections`, `sentences`, and
`entities` — none of which are anonymized, only `anonymizedText` is. If
`buildScoringUserPrompt` in `backend/src/ai/prompts/scoring.prompt.ts`
reads anything off `cv` besides `anonymizedText`, the anonymization is
silently bypassed, which would defeat the bias-mitigation story in the
README.

**Fix:** audit the prompt; if it uses fields off the raw CV, either pass an
"anonymized ParsedCV" object or pass only `anonymizedText`.

### 10. One `any` cast in a service file (NEW — violates project rule)
**File:** `backend/src/ai/ai.service.ts:95` — `(r as any).defaultWeight`
Easy cleanup: widen the parsed type from the prompt response to
include `defaultWeight` as optional, or handle the fallback at the prompt
parsing layer.

---

## 📝 Priority 3 — Polish and nice-to-haves

### 11. Add e2e tests
Create `backend/test/app.e2e-spec.ts` with Supertest tests hitting the full
API.

### 12. Add error boundary in frontend
**File:** `frontend/src/App.tsx`
Wrap routes in an error boundary so frontend crashes don't break the whole
app.

### 13. Rate limit auth endpoints
Add `@nestjs/throttler` to prevent brute force attacks on `/auth/login`.

### 14. Switch Results page from polling to SSE
**File:** `frontend/src/pages/Results.tsx`
Backend already exposes `GET /api/job-positions/:id/progress` as an SSE
stream (see `job-position.controller.ts:51-57`). Frontend currently polls
every 3s:
```typescript
const eventSource = new EventSource(
  `/api/job-positions/${jobPositionId}/progress`
)
eventSource.onmessage = (e) => {
  const progress = JSON.parse(e.data)
  // update UI
}
```

### 15. Add requirement synonyms editing in UI
**File:** `frontend/src/pages/NewJobPosition.tsx`
Currently HR can only toggle required/nice and adjust weight. Add ability to
edit keywords and synonyms too.

### 16. Improve anonymization
Current name stripping is heuristic (first line). Consider integrating a
proper NER library like `compromise` or `natural` for better name detection.

### 17. Score calibration
Thresholds in `backend/src/scoring/scoring.service.ts` (`GREAT_THRESHOLD=80`,
`GOOD_THRESHOLD=50`, `MISSING_REQUIRED_PENALTY=15`) are guesses. Test with
real CVs and calibrate.

### 18. Optional — upgrade to GPT-5.4 family
`gpt-5.4-mini` / `gpt-5.4` are the newer OpenAI models (as of late 2025 /
early 2026). Roughly 3× more expensive per token, so the default stays on
`gpt-5-mini` / `gpt-5.1`. To switch, update:
- `AI_MODEL_CHEAP` / `AI_MODEL_PREMIUM` defaults in `docker-compose.yml`
  and `.env.example`
- The pricing table in `backend/src/ai/ai.service.ts:219-223`
- The cost claim in `README.md:138`

---

## 🧪 Missing test coverage

Tests exist for: `AuthService`, `EntityExtractorService`, `AnonymizationService`, `FilterService`, `ScoringService`

Still need tests for:
- `ParserService` (integration — mock the file parsers)
- `JobDescriptionService`
- `JobPositionService` (integration)
- `CvGeneratorService`
- `AiService` (mock OpenAI SDK)
- `RankingService`

---

## 🎨 Frontend gaps

- No loading skeletons — just "Loading..." text
- No toast notifications for errors
- No retry UI when API calls fail
- Results page polls every 3s during processing; should use SSE (item 14)
- No keyboard shortcuts
- No mobile responsive polish (basic Tailwind should work but untested)

---

## 📖 README polish

Before submitting:
- Add screenshots of the working app
- Record a 2-3 minute demo video and embed link in README
- Add architecture diagram (even a hand-drawn one helps)
- Customize "Known Limitations" based on what's actually limiting after testing
