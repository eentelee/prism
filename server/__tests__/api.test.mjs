import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createApiRouter } from '../app.mjs';

class MemoryStore {
  constructor() {
    this.problems = new Map([
      [
        '2026-03-08',
        {
          date: '2026-03-08',
          published: true,
          problem: {
            code: 'C8',
            title: 'Problem C8',
            statement: 'Prove something.',
            source: 'Sample Source',
            topic: 'Combinatorics',
            answer_spec: { mode: 'proof', min_score_for_correct: 6 },
            rubric: {
              version: 1,
              max_points: 20,
              criteria: [
                { id: 'setup', label: 'Setup', max_points: 10 },
                { id: 'argument', label: 'Argument', max_points: 10 },
                { id: 'conclusion', label: 'Conclusion', max_points: 10 }
              ]
            }
          }
        }
      ],
      [
        '2026-03-09',
        {
          date: '2026-03-09',
          published: true,
          problem: {
            code: 'N1',
            title: 'Problem N1',
            statement: 'Show divisibility.',
            source: 'Sample Source',
            topic: 'Number Theory',
            answer_spec: { mode: 'proof', min_score_for_correct: 6 },
            rubric: {
              version: 1,
              max_points: 7,
              criteria: [
                { id: 'setup', label: 'Setup', max_points: 2 },
                { id: 'argument', label: 'Argument', max_points: 3 },
                { id: 'conclusion', label: 'Conclusion', max_points: 2 }
              ]
            }
          }
        }
      ]
    ]);
    this.submissions = [];
    this.hints = [];
  }

  async getProblemForDate(dateKey) {
    return this.problems.get(dateKey) || null;
  }

  async getCalendarSolvedDates(username, monthKey) {
    return new Set(
      this.submissions
        .filter((row) => row.username === username && row.date.startsWith(`${monthKey}-`))
        .map((row) => row.date)
    );
  }

  async getLeaderboard(dateKey, limit) {
    const byUser = new Map();

    this.submissions
      .filter((row) => row.date === dateKey)
      .forEach((row) => {
        const existing = byUser.get(row.username);
        if (!existing) {
          byUser.set(row.username, row);
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
          byUser.set(row.username, row);
        }
      });

    return Array.from(byUser.values())
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if (a.elapsed_seconds !== b.elapsed_seconds) {
          return a.elapsed_seconds - b.elapsed_seconds;
        }
        return a.submitted_at.localeCompare(b.submitted_at);
      })
      .slice(0, limit);
  }

  async createSubmission(input) {
    const existingCorrect = this.submissions.find(
      (row) => row.username === input.username && row.date === input.date && row.is_correct
    );
    const alreadySolved = Boolean(existingCorrect);
    const storedIsCorrect = input.evaluation.is_correct && !alreadySolved;
    const elapsed = existingCorrect
      ? existingCorrect.elapsed_seconds
      : input.elapsed_seconds;

    const row = {
      id: randomUUID(),
      date: input.date,
      username: input.username,
      score: input.evaluation.score,
      is_correct: storedIsCorrect,
      elapsed_seconds: elapsed,
      submitted_at: input.submitted_at
    };

    this.submissions.push(row);
    return {
      submission_id: row.id,
      stored_is_correct: storedIsCorrect,
      already_solved: alreadySolved,
      official_elapsed_seconds: elapsed
    };
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
    return {
      count: rows.length,
      max_level: rows.reduce((max, row) => Math.max(max, row.hint_level), 0)
    };
  }

  async createHint(input) {
    const row = {
      id: randomUUID(),
      date: input.date,
      username: input.username,
      hint_text: input.hint_text,
      hint_level: input.hint_level,
      created_at: input.created_at
    };
    this.hints.push(row);
    return {
      hint_id: row.id,
      hint_level: row.hint_level
    };
  }
}

function createHarness(startNow) {
  const state = { now: new Date(startNow).toISOString() };
  const store = new MemoryStore();
  const router = createApiRouter({
    store,
    nowProvider: () => new Date(state.now)
  });
  return {
    store,
    setNow(nextNow) {
      state.now = new Date(nextNow).toISOString();
    },
    route({ method = 'GET', url, body }) {
      return router.route(method, url, { body });
    }
  };
}

test('GET /api/daily returns locked for future day in timezone', async () => {
  const app = createHarness('2026-03-08T10:00:00.000Z');
  const res = await app.route({
    url: '/api/daily?date=2026-03-10&timezone=Europe/Belgrade'
  });
  assert.equal(res.status, 200);
  assert.equal(res.payload.locked, true);
  assert.equal(res.payload.date, '2026-03-10');
});

test('GET /api/daily unlocks immediately after local midnight', async () => {
  const app = createHarness('2026-03-08T23:30:00.000Z');
  const res = await app.route({
    url: '/api/daily?date=2026-03-09&timezone=Europe/Belgrade&username=EulerFan'
  });
  assert.equal(res.status, 200);
  assert.equal(res.payload.locked, false);
  assert.equal(res.payload.missing, false);
  assert.equal(res.payload.problem.code, 'N1');
  assert.equal(res.payload.today, '2026-03-09');
});

test('GET /api/calendar returns day states and solved flags', async () => {
  const app = createHarness('2026-03-08T10:00:00.000Z');
  await app.route({
    method: 'POST',
    url: '/api/submissions',
    body: {
      username: 'EulerFan',
      timezone: 'Europe/Belgrade',
      date: '2026-03-08',
      solution_text: 'Let us consider. Therefore this works. Thus we are done.'
    }
  });

  const res = await app.route({
    url: '/api/calendar?month=2026-03&timezone=Europe/Belgrade&username=EulerFan'
  });
  assert.equal(res.status, 200);

  const day8 = res.payload.days.find((item) => item.date === '2026-03-08');
  const day9 = res.payload.days.find((item) => item.date === '2026-03-09');

  assert.equal(day8.state, 'today');
  assert.equal(day8.solved_by_user, true);
  assert.equal(day9.state, 'future');
  assert.equal(day9.has_problem, true);
});

test('GET /api/leaderboard is rank ordered by score then elapsed_seconds', async () => {
  const app = createHarness('2026-03-08T00:15:00.000Z');
  await app.route({
    method: 'POST',
    url: '/api/submissions',
    body: {
      username: 'bob',
      timezone: 'UTC',
      date: '2026-03-08',
      solution_text: 'Let us consider. Therefore it follows. Thus done.'
    }
  });

  app.setNow('2026-03-08T00:20:00.000Z');
  await app.route({
    method: 'POST',
    url: '/api/submissions',
    body: {
      username: 'alice',
      timezone: 'UTC',
      date: '2026-03-08',
      solution_text: 'Let us consider. Therefore it follows. Thus done.'
    }
  });

  app.setNow('2026-03-08T00:25:00.000Z');
  await app.route({
    method: 'POST',
    url: '/api/submissions',
    body: {
      username: 'carol',
      timezone: 'UTC',
      date: '2026-03-08',
      solution_text: 'Short argument.'
    }
  });

  const res = await app.route({
    url: '/api/leaderboard?date=2026-03-08&limit=10'
  });
  assert.equal(res.status, 200);
  assert.equal(res.payload.leaderboard[0].username, 'bob');
  assert.equal(res.payload.leaderboard[1].username, 'alice');
  assert.equal(res.payload.leaderboard[2].username, 'carol');
});

test('POST /api/submissions clamps score to 0..7 and includes breakdown', async () => {
  const app = createHarness('2026-03-08T00:30:00.000Z');
  const longSolution = new Array(220)
    .fill('therefore')
    .join(' ');

  const res = await app.route({
    method: 'POST',
    url: '/api/submissions',
    body: {
      username: 'MaxScore',
      timezone: 'UTC',
      date: '2026-03-08',
      solution_text: `Let us consider the setup. ${longSolution} Thus done.`
    }
  });

  assert.equal(res.status, 200);
  assert.ok(res.payload.score >= 0);
  assert.ok(res.payload.score <= 7);
  assert.ok(Array.isArray(res.payload.breakdown));
});

test('POST /api/submissions keeps first correct elapsed_seconds immutable', async () => {
  const app = createHarness('2026-03-08T00:10:00.000Z');
  const solution = [
    'Let us consider a construction and define all variables carefully.',
    'Suppose each case satisfies the same invariant by induction.',
    'Therefore the key claim follows because each transition preserves the invariant.',
    'Hence every branch leads to the same terminal condition with no contradiction.',
    'Thus the proposition holds and all edge cases are covered.'
  ].join(' ');

  const first = await app.route({
    method: 'POST',
    url: '/api/submissions',
    body: {
      username: 'EulerFan',
      timezone: 'UTC',
      date: '2026-03-08',
      solution_text: solution
    }
  });
  assert.equal(first.status, 200);
  assert.equal(first.payload.is_correct, true);
  assert.equal(first.payload.elapsed_seconds, 600);

  app.setNow('2026-03-08T00:45:00.000Z');
  const second = await app.route({
    method: 'POST',
    url: '/api/submissions',
    body: {
      username: 'EulerFan',
      timezone: 'UTC',
      date: '2026-03-08',
      solution_text: `${solution} Therefore a stronger bound also holds.`
    }
  });
  assert.equal(second.status, 200);
  assert.equal(second.payload.already_solved, true);
  assert.equal(second.payload.elapsed_seconds, 600);
});

test('GET /api/leaderboard tie-breaks equal score+time by submitted_at', async () => {
  const app = createHarness('2026-03-08T00:10:00.000Z');
  const solution = 'Let us consider. Therefore we conclude. Thus done.';

  await app.route({
    method: 'POST',
    url: '/api/submissions',
    body: {
      username: 'alice',
      timezone: 'UTC',
      date: '2026-03-08',
      solution_text: solution
    }
  });

  app.setNow('2026-03-08T00:10:00.500Z');
  await app.route({
    method: 'POST',
    url: '/api/submissions',
    body: {
      username: 'bob',
      timezone: 'UTC',
      date: '2026-03-08',
      solution_text: solution
    }
  });

  const res = await app.route({
    url: '/api/leaderboard?date=2026-03-08&limit=10'
  });

  assert.equal(res.status, 200);
  assert.equal(res.payload.leaderboard[0].score, res.payload.leaderboard[1].score);
  assert.equal(
    res.payload.leaderboard[0].elapsed_seconds,
    res.payload.leaderboard[1].elapsed_seconds
  );
  assert.equal(res.payload.leaderboard[0].username, 'alice');
  assert.equal(res.payload.leaderboard[1].username, 'bob');
});

test('POST /api/hints returns progressive levels and enforces daily limit', async () => {
  const app = createHarness('2026-03-08T09:00:00.000Z');

  const one = await app.route({
    method: 'POST',
    url: '/api/hints',
    body: {
      username: 'EulerFan',
      timezone: 'UTC',
      date: '2026-03-08',
      draft_text: 'I have setup but no clean argument.'
    }
  });
  assert.equal(one.status, 200);
  assert.equal(one.payload.hint_level, 1);
  assert.equal(one.payload.remaining_hints, 2);

  const two = await app.route({
    method: 'POST',
    url: '/api/hints',
    body: {
      username: 'EulerFan',
      timezone: 'UTC',
      date: '2026-03-08',
      draft_text: 'I still struggle with the core transition.'
    }
  });
  assert.equal(two.status, 200);
  assert.equal(two.payload.hint_level, 2);
  assert.equal(two.payload.remaining_hints, 1);

  const three = await app.route({
    method: 'POST',
    url: '/api/hints',
    body: {
      username: 'EulerFan',
      timezone: 'UTC',
      date: '2026-03-08',
      draft_text: 'Need one more push.'
    }
  });
  assert.equal(three.status, 200);
  assert.equal(three.payload.hint_level, 3);
  assert.equal(three.payload.remaining_hints, 0);

  const four = await app.route({
    method: 'POST',
    url: '/api/hints',
    body: {
      username: 'EulerFan',
      timezone: 'UTC',
      date: '2026-03-08',
      draft_text: 'Another hint please.'
    }
  });
  assert.equal(four.status, 429);
});

test('POST /api/hints is blocked after first correct submission', async () => {
  const app = createHarness('2026-03-08T00:10:00.000Z');
  const solution = [
    'Let us consider a construction and define all variables carefully.',
    'Suppose each case satisfies the same invariant by induction.',
    'Therefore the key claim follows because each transition preserves the invariant.',
    'Hence every branch leads to the same terminal condition with no contradiction.',
    'Thus the proposition holds and all edge cases are covered.'
  ].join(' ');

  const submit = await app.route({
    method: 'POST',
    url: '/api/submissions',
    body: {
      username: 'SolvedUser',
      timezone: 'UTC',
      date: '2026-03-08',
      solution_text: solution
    }
  });
  assert.equal(submit.status, 200);
  assert.equal(submit.payload.is_correct, true);

  const hint = await app.route({
    method: 'POST',
    url: '/api/hints',
    body: {
      username: 'SolvedUser',
      timezone: 'UTC',
      date: '2026-03-08',
      draft_text: 'Can I get a hint anyway?'
    }
  });
  assert.equal(hint.status, 409);
});
