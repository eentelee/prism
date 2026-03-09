BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.is_valid_timezone(tz TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_timezone_names
    WHERE name = tz
  );
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE CHECK (char_length(username) BETWEEN 2 AND 24),
  timezone TEXT NOT NULL DEFAULT 'UTC' CHECK (public.is_valid_timezone(timezone)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  statement_md TEXT NOT NULL,
  source TEXT NOT NULL,
  topic TEXT NOT NULL,
  answer_spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS problem_schedule (
  local_date DATE PRIMARY KEY,
  problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE RESTRICT,
  published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS problem_rubrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  max_points INTEGER NOT NULL DEFAULT 7 CHECK (max_points = 7),
  criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  hint_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (problem_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS problem_rubrics_one_active_per_problem_idx
  ON problem_rubrics (problem_id)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE RESTRICT,
  solution_text TEXT NOT NULL,
  final_answer_text TEXT,
  is_correct BOOLEAN NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 7),
  feedback TEXT NOT NULL DEFAULT '',
  breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  elapsed_seconds INTEGER CHECK (elapsed_seconds >= 0),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  grader_model TEXT NOT NULL DEFAULT 'unknown',
  grader_prompt_version TEXT NOT NULL DEFAULT 'v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (is_correct = TRUE AND elapsed_seconds IS NOT NULL) OR
    (is_correct = FALSE)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS submissions_first_correct_per_user_date_idx
  ON submissions (user_id, local_date)
  WHERE is_correct = TRUE;

CREATE INDEX IF NOT EXISTS submissions_local_date_idx
  ON submissions (local_date);

CREATE INDEX IF NOT EXISTS submissions_problem_id_idx
  ON submissions (problem_id);

CREATE TABLE IF NOT EXISTS hint_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE RESTRICT,
  draft_text TEXT NOT NULL DEFAULT '',
  hint_text TEXT NOT NULL,
  hint_level INTEGER NOT NULL CHECK (hint_level > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, local_date, hint_level)
);

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS problems_set_updated_at ON problems;
CREATE TRIGGER problems_set_updated_at
BEFORE UPDATE ON problems
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS problem_schedule_set_updated_at ON problem_schedule;
CREATE TRIGGER problem_schedule_set_updated_at
BEFORE UPDATE ON problem_schedule
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS problem_rubrics_set_updated_at ON problem_rubrics;
CREATE TRIGGER problem_rubrics_set_updated_at
BEFORE UPDATE ON problem_rubrics
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

COMMIT;
