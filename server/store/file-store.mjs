import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function rootPath(...segments) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', '..', ...segments);
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function getProblemFromRow(row) {
  return {
    code: row.code,
    title: row.title,
    statement: row.statement,
    source: row.source,
    topic: row.topic,
    answer_spec: row.answer_spec || {},
    rubric: row.rubric || null
  };
}

function normalizeSubmission(row) {
  return {
    id: row.id,
    date: row.date,
    username: row.username,
    timezone: row.timezone || 'UTC',
    problem_code: row.problem_code || '',
    solution_text: row.solution_text || '',
    final_answer_text: row.final_answer_text || '',
    is_correct: Boolean(row.is_correct),
    score: Number(row.score) || 0,
    feedback: row.feedback || '',
    breakdown: Array.isArray(row.breakdown) ? row.breakdown : [],
    grader_model: row.grader_model || 'unknown',
    grader_prompt_version: row.grader_prompt_version || 'v1',
    elapsed_seconds: Number(row.elapsed_seconds) || 0,
    submitted_at: row.submitted_at || new Date(0).toISOString()
  };
}

function normalizeHint(row) {
  return {
    id: row.id,
    date: row.date,
    username: row.username,
    timezone: row.timezone || 'UTC',
    problem_code: row.problem_code || '',
    draft_text: row.draft_text || '',
    hint_text: row.hint_text || '',
    hint_level: Number(row.hint_level) || 1,
    created_at: row.created_at || new Date(0).toISOString()
  };
}

export class FileStore {
  constructor(options = {}) {
    this.problemPacksDir =
      options.problemPacksDir || rootPath('data', 'problem-packs');
    this.submissionsFile =
      options.submissionsFile || rootPath('data', 'runtime', 'submissions.json');
    this.hintsFile = options.hintsFile || rootPath('data', 'runtime', 'hints.json');

    this.problemByDate = this.#loadProblemSchedule();
    this.submissions = this.#loadSubmissions();
    this.hints = this.#loadHints();
  }

  #loadProblemSchedule() {
    const schedule = new Map();

    if (!fs.existsSync(this.problemPacksDir)) {
      return schedule;
    }

    const files = fs
      .readdirSync(this.problemPacksDir)
      .filter((name) => name.endsWith('.json'))
      .sort();

    files.forEach((name) => {
      const fullPath = path.join(this.problemPacksDir, name);
      const rows = readJsonFile(fullPath, []);
      if (!Array.isArray(rows)) {
        return;
      }

      rows.forEach((row) => {
        if (!row || typeof row !== 'object' || !row.date) {
          return;
        }

        schedule.set(row.date, {
          date: row.date,
          published: row.published !== false,
          problem: getProblemFromRow(row)
        });
      });
    });

    return schedule;
  }

  #loadSubmissions() {
    const rows = readJsonFile(this.submissionsFile, []);
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows
      .filter((row) => row && typeof row === 'object')
      .map(normalizeSubmission);
  }

  #persistSubmissions() {
    fs.mkdirSync(path.dirname(this.submissionsFile), { recursive: true });
    fs.writeFileSync(this.submissionsFile, JSON.stringify(this.submissions, null, 2) + '\n', 'utf8');
  }

  #loadHints() {
    const rows = readJsonFile(this.hintsFile, []);
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows
      .filter((row) => row && typeof row === 'object')
      .map(normalizeHint);
  }

  #persistHints() {
    fs.mkdirSync(path.dirname(this.hintsFile), { recursive: true });
    fs.writeFileSync(this.hintsFile, JSON.stringify(this.hints, null, 2) + '\n', 'utf8');
  }

  async getProblemForDate(dateKey) {
    return this.problemByDate.get(dateKey) || null;
  }

  async getCalendarSolvedDates(username, monthKey) {
    if (!username) {
      return new Set();
    }

    const solvedDates = this.submissions
      .filter((row) => row.username === username && row.date.startsWith(`${monthKey}-`))
      .map((row) => row.date);

    return new Set(solvedDates);
  }

  async getLeaderboard(dateKey, limit) {
    const perUser = new Map();

    this.submissions
      .filter((row) => row.date === dateKey)
      .forEach((row) => {
        const existing = perUser.get(row.username);
        if (!existing) {
          perUser.set(row.username, row);
          return;
        }

        const betterScore = row.score > existing.score;
        const betterTime =
          row.score === existing.score &&
          row.elapsed_seconds < existing.elapsed_seconds;
        const earlierSubmit =
          row.score === existing.score &&
          row.elapsed_seconds === existing.elapsed_seconds &&
          row.submitted_at < existing.submitted_at;

        if (betterScore || betterTime || earlierSubmit) {
          perUser.set(row.username, row);
        }
      });

    const sorted = Array.from(perUser.values())
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if (a.elapsed_seconds !== b.elapsed_seconds) {
          return a.elapsed_seconds - b.elapsed_seconds;
        }
        return a.submitted_at.localeCompare(b.submitted_at);
      })
      .slice(0, limit);

    return sorted;
  }

  async hasCorrectSubmission(username, dateKey) {
    return this.submissions.some(
      (row) => row.username === username && row.date === dateKey && row.is_correct
    );
  }

  async getHintUsage(username, dateKey) {
    const rows = this.hints.filter(
      (row) => row.username === username && row.date === dateKey
    );
    const maxLevel = rows.reduce((max, row) => Math.max(max, row.hint_level), 0);
    return {
      count: rows.length,
      max_level: maxLevel
    };
  }

  async createSubmission(input) {
    const existingCorrect = this.submissions.find(
      (row) => row.date === input.date && row.username === input.username && row.is_correct
    );

    const alreadySolved = Boolean(existingCorrect);
    const officialElapsedSeconds = existingCorrect
      ? existingCorrect.elapsed_seconds
      : input.evaluation.is_correct
        ? input.elapsed_seconds
        : input.elapsed_seconds;

    const storedIsCorrect = input.evaluation.is_correct && !alreadySolved;

    const row = normalizeSubmission({
      id: randomUUID(),
      date: input.date,
      username: input.username,
      timezone: input.timezone,
      problem_code: input.problem.code,
      solution_text: input.solution_text,
      final_answer_text: input.final_answer_text || '',
      is_correct: storedIsCorrect,
      score: input.evaluation.score,
      feedback: input.evaluation.feedback,
      breakdown: input.evaluation.breakdown,
      grader_model: input.grader_model || 'deterministic-rubric-v1',
      grader_prompt_version: input.grader_prompt_version || 'phase4-v1',
      elapsed_seconds: officialElapsedSeconds,
      submitted_at: input.submitted_at
    });

    this.submissions.push(row);
    this.#persistSubmissions();

    return {
      submission_id: row.id,
      already_solved: alreadySolved,
      stored_is_correct: row.is_correct,
      official_elapsed_seconds: officialElapsedSeconds
    };
  }

  async createHint(input) {
    const row = normalizeHint({
      id: randomUUID(),
      date: input.date,
      username: input.username,
      timezone: input.timezone,
      problem_code: input.problem.code,
      draft_text: input.draft_text || '',
      hint_text: input.hint_text,
      hint_level: input.hint_level,
      created_at: input.created_at
    });

    this.hints.push(row);
    this.#persistHints();

    return {
      hint_id: row.id,
      hint_level: row.hint_level
    };
  }
}
