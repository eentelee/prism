import test from 'node:test';
import assert from 'node:assert/strict';

import { createGradingAdapter } from '../lib/ai-grader.mjs';

const problem = {
  title: 'Sample Problem',
  statement: 'Prove a statement.',
  answer_spec: { mode: 'proof', min_score_for_correct: 6 },
  rubric: {
    max_points: 7,
    criteria: [
      { id: 'setup', label: 'Setup', max_points: 2 },
      { id: 'argument', label: 'Argument', max_points: 3 },
      { id: 'conclusion', label: 'Conclusion', max_points: 2 }
    ]
  }
};

function aiResponse(outputText) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { output_text: outputText };
    },
    async text() {
      return outputText;
    }
  };
}

test('grading adapter retries once after malformed JSON and then succeeds', async () => {
  const calls = [];
  const fetchImpl = async () => {
    calls.push('call');
    if (calls.length === 1) {
      return aiResponse('not json');
    }
    return aiResponse(
      JSON.stringify({
        is_correct: true,
        score: 7,
        feedback: 'Well-structured proof.',
        breakdown: [
          { criterion_id: 'setup', label: 'Setup', max_points: 2, score: 2, note: 'ok' },
          { criterion_id: 'argument', label: 'Argument', max_points: 3, score: 3, note: 'ok' },
          { criterion_id: 'conclusion', label: 'Conclusion', max_points: 2, score: 2, note: 'ok' }
        ]
      })
    );
  };

  const adapter = createGradingAdapter({
    apiKey: 'test-key',
    model: 'gpt-test',
    fetchImpl
  });

  const result = await adapter.gradeSubmission({
    problem,
    solutionText: 'Let ... therefore ... thus.',
    finalAnswerText: ''
  });

  assert.equal(calls.length, 2);
  assert.equal(result.score, 7);
  assert.equal(result.is_correct, true);
  assert.equal(result.used_fallback, false);
  assert.equal(result.grader_model, 'gpt-test');
});

test('grading adapter falls back deterministically after two failures', async () => {
  const fetchImpl = async () => {
    throw new Error('network error');
  };

  const adapter = createGradingAdapter({
    apiKey: 'test-key',
    model: 'gpt-test',
    fetchImpl
  });

  const result = await adapter.gradeSubmission({
    problem,
    solutionText: 'Very short.',
    finalAnswerText: ''
  });

  assert.equal(result.used_fallback, true);
  assert.equal(result.grader_model, 'fallback-deterministic-rubric-v1');
  assert.ok(result.score >= 0 && result.score <= 7);
});
