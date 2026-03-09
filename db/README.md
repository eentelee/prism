# Daily Problem DB Setup (Phase 1)

## 0) Load environment variables
Run:

```bash
set -a; source .env; set +a
```

Default `.env` uses `postgresql:///prism_daily?host=/tmp` so `psql` connects over local Unix socket (no TCP password prompt).

## 1) Apply schema migration
Run:

```bash
psql "$DATABASE_URL" -f db/migrations/001_daily_problem_core.sql
```

## 2) Generate March backfill problem pack
Run:

```bash
node scripts/generate-march-backfill-pack.mjs --year 2026 --output data/problem-packs/march-2026.json
```

## 3) Convert pack to SQL upserts
Run:

```bash
node scripts/import-problem-pack.mjs --input data/problem-packs/march-2026.json --output db/seeds/2026-03-backfill.sql
```

Then apply:

```bash
psql "$DATABASE_URL" -f db/seeds/2026-03-backfill.sql
```

## 4) Import any future pack (JSON or CSV)
JSON:

```bash
node scripts/import-problem-pack.mjs --input data/problem-packs/april-2026.json --output db/seeds/2026-04.sql
```

CSV:

```bash
node scripts/import-problem-pack.mjs --input data/problem-packs/april-2026.csv --output db/seeds/2026-04.sql
```
