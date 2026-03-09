const DAILY_SERIES = [
  { prefix: 'C', max: 8, topic: 'Combinatorics' },
  { prefix: 'N', max: 8, topic: 'Number Theory' },
  { prefix: 'A', max: 8, topic: 'Algebra' },
  { prefix: 'G', max: 8, topic: 'Geometry' }
];

function buildSequence() {
  const sequence = [];
  DAILY_SERIES.forEach((series) => {
    for (let i = 1; i <= series.max; i += 1) {
      sequence.push({
        code: `${series.prefix}${i}`,
        topic: series.topic
      });
    }
  });
  return sequence;
}

function buildProblemBank() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 2, 1); // March 1st (month index 2)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sequence = buildSequence();
  const problems = {};

  let index = 0;

  for (let date = new Date(start); date <= today; date.setDate(date.getDate() + 1)) {
    const dateKey = date.toISOString().split('T')[0];
    const item = sequence[index % sequence.length];

    problems[dateKey] = {
      id: `${dateKey}-${item.code}`,
      code: item.code,
      title: `IMO Shortlist 2023 ${item.topic} ${item.code}`,
      statement: `Solve IMO Shortlist 2023 ${item.code}. Write a full proof-based solution with clear claims and justification.`,
      source: `IMO Shortlist 2023, ${item.topic} (${item.code})`
    };

    index += 1;
  }

  return problems;
}

window.DAILY_PROBLEMS = buildProblemBank();
