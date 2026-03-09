function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function clampScore(value, min = 0, max = 7) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(num)));
}

function textHasAny(value, patterns) {
  const text = normalizeText(value);
  return patterns.some((p) => text.includes(p));
}

function normalizedFinalAnswers(answerSpec) {
  const accepted = Array.isArray(answerSpec?.accepted_answers)
    ? answerSpec.accepted_answers
    : [];
  return accepted.map((value) => normalizeText(value)).filter(Boolean);
}

function evaluateCriterion({
  criterion,
  solutionText,
  words,
  hasSetupLanguage,
  hasReasoningLanguage,
  hasConclusionLanguage
}) {
  const maxPoints = clampScore(criterion?.max_points ?? 0, 0, 7);
  if (maxPoints === 0) {
    return {
      criterion_id: String(criterion?.id || ''),
      label: String(criterion?.label || ''),
      max_points: 0,
      score: 0,
      note: 'No points configured.'
    };
  }

  const id = normalizeText(criterion?.id || '');
  const label = normalizeText(criterion?.label || '');
  const target = `${id} ${label}`;

  let signal = 0.35;
  if (target.includes('setup') || target.includes('observation') || target.includes('assumption')) {
    signal = hasSetupLanguage ? 1 : 0.2;
  } else if (target.includes('argument') || target.includes('proof') || target.includes('logic')) {
    signal = hasReasoningLanguage ? 1 : 0.2;
  } else if (target.includes('conclusion') || target.includes('final') || target.includes('result')) {
    signal = hasConclusionLanguage ? 1 : 0.2;
  }

  const depth = Math.min(1, words / 120);
  const raw = maxPoints * (0.4 * signal + 0.6 * depth);
  const score = clampScore(raw, 0, maxPoints);

  return {
    criterion_id: String(criterion?.id || ''),
    label: String(criterion?.label || ''),
    max_points: maxPoints,
    score,
    note: score === maxPoints ? 'Criterion satisfied.' : 'Partially satisfied.'
  };
}

function inferCorrectness({
  answerSpec,
  finalAnswerText,
  totalScore,
  words,
  hasReasoningLanguage
}) {
  const acceptedAnswers = normalizedFinalAnswers(answerSpec);
  const submittedAnswer = normalizeText(finalAnswerText);

  if (acceptedAnswers.length > 0) {
    return acceptedAnswers.includes(submittedAnswer);
  }

  const minScore = Number(answerSpec?.min_score_for_correct) || 6;
  if ((answerSpec?.mode || '').toLowerCase() === 'proof') {
    return totalScore >= minScore && words >= 40 && hasReasoningLanguage;
  }

  return totalScore >= minScore;
}

export function evaluateSubmission({
  problem,
  solutionText,
  finalAnswerText
}) {
  const answerSpec = problem?.answer_spec || {};
  const rubric = problem?.rubric || {};
  const criteria = Array.isArray(rubric.criteria) ? rubric.criteria : [];

  const words = wordCount(solutionText);
  const hasSetupLanguage = textHasAny(solutionText, ['let ', 'suppose', 'consider', 'assume']);
  const hasReasoningLanguage = textHasAny(solutionText, ['therefore', 'hence', 'because', 'implies', 'thus']);
  const hasConclusionLanguage = textHasAny(solutionText, ['qed', 'therefore', 'hence proved', 'thus']);

  const breakdown = criteria.map((criterion) =>
    evaluateCriterion({
      criterion,
      solutionText,
      words,
      hasSetupLanguage,
      hasReasoningLanguage,
      hasConclusionLanguage
    })
  );

  const total = breakdown.reduce((sum, row) => sum + row.score, 0);
  const rubricMax = clampScore(rubric.max_points ?? 7, 0, 7);
  const score = clampScore(total, 0, rubricMax || 7);

  const isCorrect = inferCorrectness({
    answerSpec,
    finalAnswerText,
    totalScore: score,
    words,
    hasReasoningLanguage
  });

  const feedback =
    score >= 6
      ? 'Strong proof. Minor refinements can improve clarity.'
      : score >= 4
        ? 'Good direction. Add tighter justification in key steps.'
        : 'Needs more structure and explicit proof steps.';

  return {
    is_correct: Boolean(isCorrect),
    score: clampScore(score, 0, 7),
    feedback,
    breakdown
  };
}
