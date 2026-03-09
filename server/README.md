# Daily API (Phase 2)

## Load environment variables
Run:

```bash
set -a; source .env; set +a
```

Optional AI env vars:

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_MODEL="gpt-4.1-mini"
```

## Start the API
Run:

```bash
npm run api:dev
```

Default address:

```text
http://0.0.0.0:8787
```

## Storage mode
- `file` mode (default when `DATABASE_URL` is not set):
  - Problems from `data/problem-packs/*.json`
  - Leaderboard/solved state from `data/runtime/submissions.json`
- `postgres` mode:
  - Set `DATABASE_URL`
  - Optional `PSQL_PATH` (defaults to `psql`)

Force mode:

```bash
DAILY_STORE_MODE=file npm run api:dev
DAILY_STORE_MODE=postgres DATABASE_URL='postgres://...' npm run api:dev
```

## Endpoints

### `GET /api/daily`
Query:
- `date` (optional, `YYYY-MM-DD`)
- `timezone` (optional, default `UTC`)
- `username` (optional)

Example:

```bash
curl 'http://localhost:8787/api/daily?date=2026-03-08&timezone=Europe/Belgrade&username=EulerFan'
```

### `GET /api/calendar`
Query:
- `month` (optional, `YYYY-MM`)
- `timezone` (optional, default `UTC`)
- `username` (optional)

Example:

```bash
curl 'http://localhost:8787/api/calendar?month=2026-03&timezone=Europe/Belgrade&username=EulerFan'
```

### `GET /api/leaderboard`
Query:
- `date` (optional, `YYYY-MM-DD`)
- `timezone` (optional, default `UTC`)
- `limit` (optional, `1..100`, default `20`)

Example:

```bash
curl 'http://localhost:8787/api/leaderboard?date=2026-03-08&limit=12'
```

### `POST /api/submissions`
Body JSON:
- `username` (required, 2..24 chars)
- `timezone` (optional, default `UTC`)
- `date` (optional, default "today" in timezone)
- `solution_text` (required)
- `final_answer_text` (optional)

Example:

```bash
curl -X POST 'http://localhost:8787/api/submissions' \
  -H 'Content-Type: application/json' \
  -d '{
    "username": "EulerFan",
    "timezone": "Europe/Belgrade",
    "date": "2026-03-08",
    "solution_text": "Let us consider ... therefore ... thus proved.",
    "final_answer_text": ""
  }'
```

Response includes:
- `is_correct`, `score`, `feedback`, `breakdown`
- `elapsed_seconds` (official elapsed time)
- `already_solved` and `stored_is_correct`
- `rank_snapshot`
- `grader_model`, `grader_prompt_version`, `used_fallback`

### `POST /api/hints`
Body JSON:
- `username` (required, 2..24 chars)
- `timezone` (optional, default `UTC`)
- `date` (optional, default "today" in timezone)
- `draft_text` (optional)

Example:

```bash
curl -X POST 'http://localhost:8787/api/hints' \
  -H 'Content-Type: application/json' \
  -d '{
    "username": "EulerFan",
    "timezone": "Europe/Belgrade",
    "date": "2026-03-08",
    "draft_text": "I do not know how to continue after the first claim."
  }'
```

Rules:
- max hints per day comes from `problem.rubric.hint_policy.max_hints` (default `3`)
- hints are blocked after first correct submission
- every hint request is persisted for audit (`hint_requests`)

## Timer semantics
- Elapsed time is measured from local midnight (`00:00`) for the submission date.
- First correct submission locks the official `elapsed_seconds`.
- Later submissions cannot improve official elapsed time.

## Tests
Run:

```bash
npm run test:api
```
