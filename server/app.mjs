import http from 'node:http';
import {
  buildDateKey,
  compareDateKeys,
  daysInMonth,
  elapsedSecondsFromLocalMidnight,
  isValidDateKey,
  isValidMonthKey,
  isValidTimezone,
  toDateKeyInTimezone,
  toMonthKeyInTimezone
} from './lib/date.mjs';
import { createGradingAdapter } from './lib/ai-grader.mjs';
import { createHintAdapter } from './lib/ai-hints.mjs';
import { errorResponse, jsonResponse, withCors } from './lib/http.mjs';

function sanitizeUsername(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (trimmed.length < 2 || trimmed.length > 24) {
    return '';
  }
  return trimmed;
}

function parseLimit(value) {
  if (value === undefined || value === null || value === '') {
    return 20;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return null;
  }
  return parsed;
}

function normalizeTimezone(value) {
  const timezone = value ? String(value).trim() : 'UTC';
  return timezone || 'UTC';
}

function sanitizeText(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value).trim();
}

export function createApiRouter({
  store,
  nowProvider = () => new Date(),
  gradingAdapter = createGradingAdapter(),
  hintAdapter = createHintAdapter()
}) {
  if (!store) {
    throw new Error('createApiRouter requires a store instance.');
  }

  async function daily(url) {
    const timezone = normalizeTimezone(url.searchParams.get('timezone'));
    const requestedDate = url.searchParams.get('date');
    const username = sanitizeUsername(url.searchParams.get('username'));

    if (!isValidTimezone(timezone)) {
      return { status: 400, payload: { error: 'Invalid timezone.' } };
    }

    const now = nowProvider();
    const todayKey = toDateKeyInTimezone(now, timezone);
    const dateKey = requestedDate || todayKey;

    if (!isValidDateKey(dateKey)) {
      return {
        status: 400,
        payload: { error: 'Invalid date. Use YYYY-MM-DD.' }
      };
    }

    if (compareDateKeys(dateKey, todayKey) > 0) {
      return {
        status: 200,
        payload: {
          date: dateKey,
          timezone,
          today: todayKey,
          locked: true
        }
      };
    }

    const scheduled = await store.getProblemForDate(dateKey);
    if (!scheduled || scheduled.published === false || !scheduled.problem) {
      return {
        status: 200,
        payload: {
          date: dateKey,
          timezone,
          today: todayKey,
          locked: false,
          missing: true
        }
      };
    }

    let solvedByUser = false;
    if (username) {
      const monthKey = dateKey.slice(0, 7);
      const solvedDates = await store.getCalendarSolvedDates(username, monthKey);
      solvedByUser = solvedDates.has(dateKey);
    }

    return {
      status: 200,
      payload: {
        date: dateKey,
        timezone,
        today: todayKey,
        locked: false,
        missing: false,
        solved_by_user: solvedByUser,
        problem: scheduled.problem
      }
    };
  }

  async function calendar(url) {
    const timezone = normalizeTimezone(url.searchParams.get('timezone'));
    const requestedMonth = url.searchParams.get('month');
    const username = sanitizeUsername(url.searchParams.get('username'));

    if (!isValidTimezone(timezone)) {
      return { status: 400, payload: { error: 'Invalid timezone.' } };
    }

    const now = nowProvider();
    const todayKey = toDateKeyInTimezone(now, timezone);
    const defaultMonth = toMonthKeyInTimezone(now, timezone);
    const monthKey = requestedMonth || defaultMonth;

    if (!isValidMonthKey(monthKey)) {
      return {
        status: 400,
        payload: { error: 'Invalid month. Use YYYY-MM.' }
      };
    }

    const totalDays = daysInMonth(monthKey);
    const solvedDates = await store.getCalendarSolvedDates(username, monthKey);
    const days = [];

    for (let day = 1; day <= totalDays; day += 1) {
      const dateKey = buildDateKey(monthKey, day);
      const relation = compareDateKeys(dateKey, todayKey);
      const state = relation < 0 ? 'past' : relation === 0 ? 'today' : 'future';
      const scheduled = await store.getProblemForDate(dateKey);

      days.push({
        date: dateKey,
        day,
        state,
        has_problem: Boolean(scheduled && scheduled.published !== false),
        solved_by_user: solvedDates.has(dateKey)
      });
    }

    return {
      status: 200,
      payload: {
        month: monthKey,
        timezone,
        today: todayKey,
        days
      }
    };
  }

  async function leaderboard(url) {
    const timezone = normalizeTimezone(url.searchParams.get('timezone'));
    const requestedDate = url.searchParams.get('date');
    const limit = parseLimit(url.searchParams.get('limit'));

    if (!isValidTimezone(timezone)) {
      return { status: 400, payload: { error: 'Invalid timezone.' } };
    }

    if (limit === null) {
      return {
        status: 400,
        payload: { error: 'Invalid limit. Use integer range 1..100.' }
      };
    }

    const now = nowProvider();
    const todayKey = toDateKeyInTimezone(now, timezone);
    const dateKey = requestedDate || todayKey;

    if (!isValidDateKey(dateKey)) {
      return {
        status: 400,
        payload: { error: 'Invalid date. Use YYYY-MM-DD.' }
      };
    }

    const rows = await store.getLeaderboard(dateKey, limit);
    const orderedRows = rows
      .slice()
      .sort((a, b) => {
        if ((a.score || 0) !== (b.score || 0)) {
          return (b.score || 0) - (a.score || 0);
        }
        if ((a.elapsed_seconds || 0) !== (b.elapsed_seconds || 0)) {
          return (a.elapsed_seconds || 0) - (b.elapsed_seconds || 0);
        }
        return String(a.submitted_at || '').localeCompare(String(b.submitted_at || ''));
      })
      .slice(0, limit);

    const leaderboardRows = orderedRows.map((row, index) => ({
      rank: index + 1,
      username: row.username,
      score: Number(row.score) || 0,
      elapsed_seconds: Number(row.elapsed_seconds) || 0,
      submitted_at: row.submitted_at
    }));

    return {
      status: 200,
      payload: {
        date: dateKey,
        timezone,
        leaderboard: leaderboardRows
      }
    };
  }

  async function submissions(url, request = {}) {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const timezone = normalizeTimezone(body.timezone || url.searchParams.get('timezone'));
    const username = sanitizeUsername(body.username || url.searchParams.get('username'));
    const requestedDate = sanitizeText(body.date, '');
    const solutionText = sanitizeText(body.solution_text, '');
    const finalAnswerText = sanitizeText(body.final_answer_text, '');

    if (!isValidTimezone(timezone)) {
      return { status: 400, payload: { error: 'Invalid timezone.' } };
    }

    if (!username) {
      return {
        status: 400,
        payload: { error: 'username is required (2..24 chars).' }
      };
    }

    if (!solutionText) {
      return {
        status: 400,
        payload: { error: 'solution_text is required.' }
      };
    }

    const now = nowProvider();
    const todayKey = toDateKeyInTimezone(now, timezone);
    const dateKey = requestedDate || todayKey;

    if (!isValidDateKey(dateKey)) {
      return {
        status: 400,
        payload: { error: 'Invalid date. Use YYYY-MM-DD.' }
      };
    }

    if (compareDateKeys(dateKey, todayKey) > 0) {
      return {
        status: 400,
        payload: { error: 'Cannot submit for a future date.' }
      };
    }

    const scheduled = await store.getProblemForDate(dateKey);
    if (!scheduled || scheduled.published === false || !scheduled.problem) {
      return {
        status: 404,
        payload: { error: 'No scheduled problem for selected date.' }
      };
    }

    const evaluation = await gradingAdapter.gradeSubmission({
      problem: scheduled.problem,
      solutionText,
      finalAnswerText
    });

    const elapsedSeconds = elapsedSecondsFromLocalMidnight({
      dateKey,
      timezone,
      nowDate: now
    });

    const submittedAt = now.toISOString();
    const persisted = await store.createSubmission({
      username,
      timezone,
      date: dateKey,
      problem: scheduled.problem,
      solution_text: solutionText,
      final_answer_text: finalAnswerText,
      evaluation,
      elapsed_seconds: elapsedSeconds,
      submitted_at: submittedAt,
      grader_model: evaluation.grader_model,
      grader_prompt_version: evaluation.grader_prompt_version
    });

    const rows = await store.getLeaderboard(dateKey, 5000);
    const rank = rows.findIndex((entry) => entry.username === username);

    return {
      status: 200,
      payload: {
        date: dateKey,
        timezone,
        is_correct: evaluation.is_correct,
        stored_is_correct: persisted.stored_is_correct,
        already_solved: persisted.already_solved,
        score: evaluation.score,
        feedback: evaluation.feedback,
        breakdown: evaluation.breakdown,
        elapsed_seconds: persisted.official_elapsed_seconds,
        submitted_at: submittedAt,
        rank_snapshot: {
          rank: rank >= 0 ? rank + 1 : null,
          total_entries: rows.length
        },
        grader_model: evaluation.grader_model,
        grader_prompt_version: evaluation.grader_prompt_version,
        used_fallback: Boolean(evaluation.used_fallback)
      }
    };
  }

  async function hints(url, request = {}) {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const timezone = normalizeTimezone(body.timezone || url.searchParams.get('timezone'));
    const username = sanitizeUsername(body.username || url.searchParams.get('username'));
    const requestedDate = sanitizeText(body.date, '');
    const draftText = sanitizeText(body.draft_text, '');

    if (!isValidTimezone(timezone)) {
      return { status: 400, payload: { error: 'Invalid timezone.' } };
    }

    if (!username) {
      return {
        status: 400,
        payload: { error: 'username is required (2..24 chars).' }
      };
    }

    const now = nowProvider();
    const todayKey = toDateKeyInTimezone(now, timezone);
    const dateKey = requestedDate || todayKey;

    if (!isValidDateKey(dateKey)) {
      return {
        status: 400,
        payload: { error: 'Invalid date. Use YYYY-MM-DD.' }
      };
    }

    if (compareDateKeys(dateKey, todayKey) > 0) {
      return {
        status: 400,
        payload: { error: 'Cannot request hints for a future date.' }
      };
    }

    const scheduled = await store.getProblemForDate(dateKey);
    if (!scheduled || scheduled.published === false || !scheduled.problem) {
      return {
        status: 404,
        payload: { error: 'No scheduled problem for selected date.' }
      };
    }

    const solved = await store.hasCorrectSubmission(username, dateKey);
    if (solved) {
      return {
        status: 409,
        payload: { error: 'Hints are unavailable after first correct submission.' }
      };
    }

    const usage = await store.getHintUsage(username, dateKey);
    const maxHints = Number(scheduled.problem?.rubric?.hint_policy?.max_hints) || 3;
    if (usage.count >= maxHints) {
      return {
        status: 429,
        payload: {
          error: 'Daily hint limit reached.',
          remaining_hints: 0
        }
      };
    }

    const hintLevel = usage.max_level + 1;
    const generated = await hintAdapter.generateHint({
      problem: scheduled.problem,
      draftText,
      hintLevel,
      maxHints
    });

    const createdAt = now.toISOString();
    await store.createHint({
      username,
      timezone,
      date: dateKey,
      problem: scheduled.problem,
      draft_text: draftText,
      hint_text: generated.hint_text,
      hint_level: hintLevel,
      created_at: createdAt
    });

    return {
      status: 200,
      payload: {
        date: dateKey,
        timezone,
        hint_text: generated.hint_text,
        hint_level: hintLevel,
        remaining_hints: Math.max(0, maxHints - hintLevel),
        hint_model: generated.hint_model,
        used_fallback: Boolean(generated.used_fallback)
      }
    };
  }

  async function route(method, rawUrl, request = {}) {
    if (method === 'OPTIONS') {
      return { status: 204, payload: null };
    }

    const url = new URL(rawUrl, 'http://localhost');

    if (method === 'POST' && url.pathname === '/api/submissions') {
      return submissions(url, request);
    }

    if (method === 'POST' && url.pathname === '/api/hints') {
      return hints(url, request);
    }

    if (method !== 'GET') {
      return { status: 405, payload: { error: 'Method not allowed.' } };
    }

    if (url.pathname === '/api/health') {
      return { status: 200, payload: { ok: true } };
    }

    if (url.pathname === '/api/daily') {
      return daily(url);
    }

    if (url.pathname === '/api/calendar') {
      return calendar(url);
    }

    if (url.pathname === '/api/leaderboard') {
      return leaderboard(url);
    }

    return { status: 404, payload: { error: 'Not found.' } };
  }

  return { route };
}

export function createApp({ store, nowProvider = () => new Date() }) {
  const router = createApiRouter({ store, nowProvider });

  return http.createServer(async (req, res) => {
    withCors(req, res);

    try {
      let body = undefined;
      if ((req.method || 'GET') === 'POST') {
        const chunks = [];
        let totalBytes = 0;

        for await (const chunk of req) {
          totalBytes += chunk.length;
          if (totalBytes > 512 * 1024) {
            return errorResponse(res, 413, 'Request body too large.');
          }
          chunks.push(chunk);
        }

        const rawBody = Buffer.concat(chunks).toString('utf8').trim();
        if (rawBody.length > 0) {
          try {
            body = JSON.parse(rawBody);
          } catch (error) {
            return errorResponse(res, 400, 'Invalid JSON body.');
          }
        } else {
          body = {};
        }
      }

      const result = await router.route(req.method || 'GET', req.url || '/', {
        body
      });
      if (result.status === 204) {
        res.statusCode = 204;
        res.end();
        return;
      }
      return jsonResponse(res, result.status, result.payload);
    } catch (error) {
      return errorResponse(res, 500, 'Internal server error.', error.message);
    }
  });
}
