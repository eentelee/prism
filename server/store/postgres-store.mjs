import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

function sqlNumber(value) {
  const num = Number(value);
  if (!Number.isInteger(num)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }
  return String(num);
}

function sqlBoolean(value) {
  return value ? 'TRUE' : 'FALSE';
}

function parseJsonOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  return JSON.parse(trimmed);
}

export class PostgresStore {
  constructor(options = {}) {
    this.databaseUrl = options.databaseUrl || process.env.DATABASE_URL || '';
    this.psqlPath = options.psqlPath || process.env.PSQL_PATH || 'psql';

    if (!this.databaseUrl) {
      throw new Error('DATABASE_URL is required for PostgresStore.');
    }
  }

  async #queryJson(sql) {
    const args = [
      this.databaseUrl,
      '-X',
      '-q',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql
    ];

    const { stdout } = await execFileAsync(this.psqlPath, args, {
      maxBuffer: 10 * 1024 * 1024
    });
    return parseJsonOutput(stdout);
  }

  async getProblemForDate(dateKey) {
    const sql = `
      SELECT row_to_json(t)
      FROM (
        SELECT
          s.local_date::text AS date,
          s.published AS published,
          p.code AS code,
          p.title AS title,
          p.statement_md AS statement,
          p.source AS source,
          p.topic AS topic,
          p.answer_spec AS answer_spec,
          (
            SELECT row_to_json(r)
            FROM (
              SELECT pr.version, pr.max_points, pr.criteria, pr.hint_policy
              FROM problem_rubrics pr
              WHERE pr.problem_id = p.id
                AND pr.is_active = TRUE
              ORDER BY pr.version DESC
              LIMIT 1
            ) r
          ) AS rubric
        FROM problem_schedule s
        JOIN problems p ON p.id = s.problem_id
        WHERE s.local_date = DATE ${sqlString(dateKey)}
        LIMIT 1
      ) t;
    `;

    const row = await this.#queryJson(sql);
    if (!row) {
      return null;
    }

    return {
      date: row.date,
      published: row.published,
      problem: {
        code: row.code,
        title: row.title,
        statement: row.statement,
        source: row.source,
        topic: row.topic,
        answer_spec: row.answer_spec || {},
        rubric: row.rubric || null
      }
    };
  }

  async getCalendarSolvedDates(username, monthKey) {
    if (!username) {
      return new Set();
    }

    const monthStart = `${monthKey}-01`;
    const [yearText, monthText] = monthKey.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const nextMonth = new Date(Date.UTC(year, month - 1, 1));
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const nextMonthKey = nextMonth.toISOString().slice(0, 10);

    const sql = `
      SELECT COALESCE(json_agg(t.local_date), '[]'::json)
      FROM (
        SELECT DISTINCT s.local_date::text AS local_date
        FROM submissions s
        JOIN users u ON u.id = s.user_id
        WHERE u.username = ${sqlString(username)}
          AND s.local_date >= DATE ${sqlString(monthStart)}
          AND s.local_date < DATE ${sqlString(nextMonthKey)}
      ) t;
    `;

    const rows = (await this.#queryJson(sql)) || [];
    return new Set(rows);
  }

  async getLeaderboard(dateKey, limit) {
    const sql = `
      SELECT COALESCE(json_agg(t), '[]'::json)
      FROM (
        SELECT
          u.username AS username,
          s.score AS score,
          s.elapsed_seconds AS elapsed_seconds,
          s.submitted_at::text AS submitted_at
        FROM (
          SELECT DISTINCT ON (user_id)
            user_id,
            score,
            elapsed_seconds,
            submitted_at
          FROM submissions
          WHERE local_date = DATE ${sqlString(dateKey)}
          ORDER BY
            user_id,
            score DESC,
            elapsed_seconds ASC NULLS LAST,
            submitted_at ASC
        ) s
        JOIN users u ON u.id = s.user_id
        ORDER BY
          s.score DESC,
          s.elapsed_seconds ASC NULLS LAST,
          s.submitted_at ASC
        LIMIT ${sqlNumber(limit)}
      ) t;
    `;

    return (await this.#queryJson(sql)) || [];
  }

  async hasCorrectSubmission(username, dateKey) {
    const sql = `
      SELECT (
        EXISTS (
          SELECT 1
          FROM submissions s
          JOIN users u ON u.id = s.user_id
          WHERE u.username = ${sqlString(username)}
            AND s.local_date = DATE ${sqlString(dateKey)}
            AND s.is_correct = TRUE
        )
      ) AS solved;
    `;

    const row = await this.#queryJson(sql);
    return Boolean(row?.solved);
  }

  async getHintUsage(username, dateKey) {
    const sql = `
      SELECT row_to_json(t)
      FROM (
        SELECT
          COUNT(*)::int AS count,
          COALESCE(MAX(h.hint_level), 0)::int AS max_level
        FROM hint_requests h
        JOIN users u ON u.id = h.user_id
        WHERE u.username = ${sqlString(username)}
          AND h.local_date = DATE ${sqlString(dateKey)}
      ) t;
    `;

    const row = await this.#queryJson(sql);
    return {
      count: Number(row?.count) || 0,
      max_level: Number(row?.max_level) || 0
    };
  }

  async createSubmission(input) {
    const sql = `
      WITH ensured_user AS (
        INSERT INTO users (username, timezone)
        VALUES (${sqlString(input.username)}, ${sqlString(input.timezone)})
        ON CONFLICT (username) DO UPDATE
        SET
          timezone = EXCLUDED.timezone,
          updated_at = NOW()
        RETURNING id
      ),
      user_row AS (
        SELECT id FROM ensured_user
      ),
      selected_problem AS (
        SELECT
          p.id AS problem_id
        FROM problem_schedule s
        JOIN problems p ON p.id = s.problem_id
        WHERE s.local_date = DATE ${sqlString(input.date)}
          AND s.published = TRUE
        LIMIT 1
      ),
      first_try AS (
        INSERT INTO submissions (
          user_id,
          local_date,
          problem_id,
          solution_text,
          final_answer_text,
          is_correct,
          score,
          feedback,
          breakdown,
          elapsed_seconds,
          submitted_at,
          grader_model,
          grader_prompt_version,
          created_at
        )
        SELECT
          (SELECT id FROM user_row),
          DATE ${sqlString(input.date)},
          (SELECT problem_id FROM selected_problem),
          ${sqlString(input.solution_text)},
          ${sqlString(input.final_answer_text || '')},
          ${sqlBoolean(input.evaluation.is_correct)},
          ${sqlNumber(input.evaluation.score)},
          ${sqlString(input.evaluation.feedback || '')},
          ${sqlJson(input.evaluation.breakdown || [])},
          ${sqlNumber(input.elapsed_seconds)},
          TIMESTAMPTZ ${sqlString(input.submitted_at)},
          ${sqlString(input.grader_model || 'deterministic-rubric-v1')},
          ${sqlString(input.grader_prompt_version || 'phase4-v1')},
          NOW()
        WHERE EXISTS (SELECT 1 FROM selected_problem)
        ON CONFLICT (user_id, local_date) WHERE is_correct DO NOTHING
        RETURNING id, is_correct, elapsed_seconds
      ),
      fallback_try AS (
        INSERT INTO submissions (
          user_id,
          local_date,
          problem_id,
          solution_text,
          final_answer_text,
          is_correct,
          score,
          feedback,
          breakdown,
          elapsed_seconds,
          submitted_at,
          grader_model,
          grader_prompt_version,
          created_at
        )
        SELECT
          (SELECT id FROM user_row),
          DATE ${sqlString(input.date)},
          (SELECT problem_id FROM selected_problem),
          ${sqlString(input.solution_text)},
          ${sqlString(input.final_answer_text || '')},
          FALSE,
          ${sqlNumber(input.evaluation.score)},
          ${sqlString(input.evaluation.feedback || '')},
          ${sqlJson(input.evaluation.breakdown || [])},
          (
            SELECT s.elapsed_seconds
            FROM submissions s
            WHERE s.user_id = (SELECT id FROM user_row)
              AND s.local_date = DATE ${sqlString(input.date)}
              AND s.is_correct = TRUE
            ORDER BY s.submitted_at ASC
            LIMIT 1
          ),
          TIMESTAMPTZ ${sqlString(input.submitted_at)},
          ${sqlString(input.grader_model || 'deterministic-rubric-v1')},
          ${sqlString(input.grader_prompt_version || 'phase4-v1')},
          NOW()
        WHERE EXISTS (SELECT 1 FROM selected_problem)
          AND ${sqlBoolean(input.evaluation.is_correct)}
          AND NOT EXISTS (SELECT 1 FROM first_try)
        RETURNING id, is_correct, elapsed_seconds
      ),
      picked AS (
        SELECT * FROM first_try
        UNION ALL
        SELECT * FROM fallback_try
        LIMIT 1
      ),
      official AS (
        SELECT COALESCE(
          (
            SELECT s.elapsed_seconds
            FROM submissions s
            WHERE s.user_id = (SELECT id FROM user_row)
              AND s.local_date = DATE ${sqlString(input.date)}
              AND s.is_correct = TRUE
            ORDER BY s.submitted_at ASC
            LIMIT 1
          ),
          (SELECT elapsed_seconds FROM picked),
          ${sqlNumber(input.elapsed_seconds)}
        ) AS elapsed_seconds
      )
      SELECT row_to_json(t)
      FROM (
        SELECT
          (SELECT EXISTS (SELECT 1 FROM selected_problem)) AS has_problem,
          (SELECT id::text FROM picked) AS submission_id,
          COALESCE((SELECT is_correct FROM picked), FALSE) AS stored_is_correct,
          ((SELECT COUNT(*) FROM fallback_try) > 0) AS already_solved,
          (SELECT elapsed_seconds FROM official) AS official_elapsed_seconds
      ) t;
    `;

    const row = await this.#queryJson(sql);
    if (!row || !row.has_problem || !row.submission_id) {
      throw new Error('No scheduled problem for selected date.');
    }

    return {
      submission_id: row.submission_id,
      stored_is_correct: Boolean(row.stored_is_correct),
      already_solved: Boolean(row.already_solved),
      official_elapsed_seconds: Number(row.official_elapsed_seconds) || 0
    };
  }

  async createHint(input) {
    const sql = `
      WITH ensured_user AS (
        INSERT INTO users (username, timezone)
        VALUES (${sqlString(input.username)}, ${sqlString(input.timezone)})
        ON CONFLICT (username) DO UPDATE
        SET
          timezone = EXCLUDED.timezone,
          updated_at = NOW()
        RETURNING id
      ),
      user_row AS (
        SELECT id FROM ensured_user
      ),
      selected_problem AS (
        SELECT p.id AS problem_id
        FROM problems p
        WHERE p.code = ${sqlString(input.problem.code)}
        LIMIT 1
      ),
      inserted AS (
        INSERT INTO hint_requests (
          user_id,
          local_date,
          problem_id,
          draft_text,
          hint_text,
          hint_level,
          created_at
        )
        SELECT
          (SELECT id FROM user_row),
          DATE ${sqlString(input.date)},
          (SELECT problem_id FROM selected_problem),
          ${sqlString(input.draft_text || '')},
          ${sqlString(input.hint_text)},
          ${sqlNumber(input.hint_level)},
          TIMESTAMPTZ ${sqlString(input.created_at)}
        WHERE EXISTS (SELECT 1 FROM selected_problem)
        ON CONFLICT (user_id, local_date, hint_level) DO UPDATE
        SET
          draft_text = EXCLUDED.draft_text,
          hint_text = EXCLUDED.hint_text
        RETURNING id, hint_level
      )
      SELECT row_to_json(t)
      FROM (
        SELECT id::text AS hint_id, hint_level
        FROM inserted
        LIMIT 1
      ) t;
    `;

    const row = await this.#queryJson(sql);
    if (!row?.hint_id) {
      throw new Error('Failed to create hint.');
    }

    return {
      hint_id: row.hint_id,
      hint_level: Number(row.hint_level) || 1
    };
  }
}
