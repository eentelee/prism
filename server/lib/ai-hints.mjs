import { evaluateSubmission } from './evaluate.mjs';

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

function unmetCriterion(problem, draftText) {
  const evaluated = evaluateSubmission({
    problem,
    solutionText: draftText,
    finalAnswerText: ''
  });

  const breakdown = Array.isArray(evaluated.breakdown) ? evaluated.breakdown : [];
  return breakdown.find((row) => (row.score || 0) < (row.max_points || 0)) || null;
}

function deterministicHint({ problem, draftText, hintLevel }) {
  const criterion = unmetCriterion(problem, draftText);
  const criterionLabel = safeString(criterion?.label, 'core argument');

  if (hintLevel <= 1) {
    return `Focus on the ${criterionLabel.toLowerCase()} first: write one explicit claim and state why it is true.`;
  }

  if (hintLevel === 2) {
    return `Add a bridge step for ${criterionLabel.toLowerCase()}: identify the key invariant or transformation before concluding.`;
  }

  return `Build a 3-step skeleton: setup assumptions, prove the key lemma for ${criterionLabel.toLowerCase()}, then finish with a concise conclusion.`;
}

function buildHintPrompt({ problem, draftText, hintLevel, maxHints, hintPolicy }) {
  const noFinal = hintPolicy?.allow_final_answer === true ? 'false' : 'true';
  const noFullProof = hintPolicy?.allow_full_proof === true ? 'false' : 'true';

  return [
    'You are giving a non-spoiler math olympiad hint.',
    `Hint level: ${hintLevel} of ${maxHints}`,
    `Never provide final answer: ${noFinal}`,
    `Never provide full proof dump: ${noFullProof}`,
    'Keep output to 1-2 short sentences.',
    '',
    `Problem title: ${safeString(problem?.title)}`,
    `Problem statement: ${safeString(problem?.statement)}`,
    `Rubric: ${JSON.stringify(problem?.rubric || {})}`,
    '',
    `Student draft: ${safeString(draftText)}`
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

export function createHintAdapter(options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
  const model = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    async generateHint({
      problem,
      draftText,
      hintLevel,
      maxHints
    }) {
      const hintPolicy = problem?.rubric?.hint_policy || {};

      if (!apiKey || !fetchImpl) {
        return {
          hint_text: deterministicHint({
            problem,
            draftText,
            hintLevel
          }),
          hint_model: 'deterministic-hints-v1',
          used_fallback: false
        };
      }

      const prompt = buildHintPrompt({
        problem,
        draftText,
        hintLevel,
        maxHints,
        hintPolicy
      });

      try {
        const hint = await callOpenAI({
          apiKey,
          model,
          prompt,
          fetchImpl
        });

        return {
          hint_text: hint,
          hint_model: model,
          used_fallback: false
        };
      } catch (error) {
        return {
          hint_text: deterministicHint({
            problem,
            draftText,
            hintLevel
          }),
          hint_model: 'fallback-deterministic-hints-v1',
          used_fallback: true
        };
      }
    }
  };
}
