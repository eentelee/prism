import { evaluateSubmission } from './evaluate.mjs';

function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(num)));
}

function safeString(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value).trim();
}

function extractTextFromResponsePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks = [];
  const visit = (node) => {
    if (!node) return;
    if (typeof node === 'string') return;

    if (Array.isArray(node)) {
      node.forEach((item) => visit(item));
      return;
    }

    if (typeof node === 'object') {
      if (typeof node.text === 'string') {
        chunks.push(node.text);
      }
      Object.values(node).forEach((value) => visit(value));
    }
  };

  visit(payload.output);
  return chunks.join('\n').trim();
}

function parseJsonFromText(rawText) {
  const text = safeString(rawText);
  if (!text) {
    throw new Error('Empty model output.');
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) {
      const candidate = text.slice(first, last + 1);
      return JSON.parse(candidate);
    }
    throw error;
  }
}

function normalizeBreakdown(rawBreakdown, rubric) {
  const criteria = Array.isArray(rubric?.criteria) ? rubric.criteria : [];
  const defaultRows = criteria.map((item) => ({
    criterion_id: safeString(item?.id),
    label: safeString(item?.label),
    max_points: clamp(item?.max_points ?? 0, 0, 7),
    score: 0,
    note: ''
  }));

  if (!Array.isArray(rawBreakdown)) {
    return defaultRows;
  }

  return rawBreakdown.map((row, index) => {
    const criterion = criteria[index] || {};
    const maxPoints = clamp(
      row?.max_points ?? criterion?.max_points ?? 0,
      0,
      7
    );
    return {
      criterion_id: safeString(row?.criterion_id ?? criterion?.id),
      label: safeString(row?.label ?? criterion?.label),
      max_points: maxPoints,
      score: clamp(row?.score ?? 0, 0, maxPoints),
      note: safeString(row?.note)
    };
  });
}

function normalizeAiGrade(payload, problem) {
  const rubric = problem?.rubric || {};
  const parsed = parseJsonFromText(payload);

  const score = clamp(parsed?.score ?? 0, 0, 7);
  const isCorrect = Boolean(parsed?.is_correct);
  const feedback = safeString(parsed?.feedback, 'AI grading complete.');
  const breakdown = normalizeBreakdown(parsed?.breakdown, rubric);

  return {
    is_correct: isCorrect,
    score,
    feedback,
    breakdown
  };
}

function buildGradingPrompt({ problem, solutionText, finalAnswerText }) {
  const rubric = problem?.rubric || {};
  const criteria = Array.isArray(rubric?.criteria) ? rubric.criteria : [];
  const answerSpec = problem?.answer_spec || {};

  return [
    'You are grading a math olympiad-style solution.',
    'Use the rubric exactly and be strict.',
    'Never output markdown. Return JSON only.',
    '',
    `Problem title: ${safeString(problem?.title)}`,
    `Problem statement: ${safeString(problem?.statement)}`,
    `Answer checker config: ${JSON.stringify(answerSpec)}`,
    `Rubric max points: ${clamp(rubric?.max_points ?? 7, 0, 7)}`,
    `Rubric criteria: ${JSON.stringify(criteria)}`,
    '',
    `Student final answer: ${safeString(finalAnswerText)}`,
    `Student solution: ${safeString(solutionText)}`,
    '',
    'Return this JSON shape:',
    '{"is_correct": boolean, "score": number, "feedback": "string", "breakdown": [{"criterion_id":"string","label":"string","max_points":number,"score":number,"note":"string"}]}',
    'Rules:',
    '- score must be integer 0..7.',
    '- breakdown scores must be non-negative and not exceed max_points.',
    '- Keep feedback to one sentence.'
  ].join('\n');
}

async function callOpenAI({
  apiKey,
  model,
  prompt,
  fetchImpl,
  timeoutMs = 30000
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input: prompt
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${message}`);
    }

    const payload = await response.json();
    const text = extractTextFromResponsePayload(payload);
    if (!text) {
      throw new Error('OpenAI response had no text output.');
    }

    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createGradingAdapter(options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
  const model = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    async gradeSubmission({ problem, solutionText, finalAnswerText }) {
      const deterministic = evaluateSubmission({
        problem,
        solutionText,
        finalAnswerText
      });

      if (!apiKey || !fetchImpl) {
        return {
          ...deterministic,
          grader_model: 'deterministic-rubric-v1',
          grader_prompt_version: 'phase4-v1',
          used_fallback: false
        };
      }

      const prompt = buildGradingPrompt({
        problem,
        solutionText,
        finalAnswerText
      });

      let lastError = null;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const text = await callOpenAI({
            apiKey,
            model,
            prompt,
            fetchImpl
          });
          const normalized = normalizeAiGrade(text, problem);
          return {
            ...normalized,
            grader_model: model,
            grader_prompt_version: 'phase4-v1',
            used_fallback: false
          };
        } catch (error) {
          lastError = error;
        }
      }

      return {
        ...deterministic,
        feedback: `${deterministic.feedback} AI fallback used.`,
        grader_model: 'fallback-deterministic-rubric-v1',
        grader_prompt_version: 'phase4-v1',
        used_fallback: true,
        fallback_reason: safeString(lastError?.message)
      };
    }
  };
}
