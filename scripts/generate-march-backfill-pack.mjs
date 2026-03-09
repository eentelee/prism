#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const DAILY_SERIES = [
  { prefix: 'C', max: 8, topic: 'Combinatorics' },
  { prefix: 'N', max: 8, topic: 'Number Theory' },
  { prefix: 'A', max: 8, topic: 'Algebra' },
  { prefix: 'G', max: 8, topic: 'Geometry' }
];

function parseArgs(argv) {
  const options = {
    year: new Date().getFullYear(),
    output: ''
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--year') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1900 || value > 3000) {
        throw new Error(`Invalid --year value: ${argv[i]}`);
      }
      options.year = value;
      continue;
    }
    if (arg === '--output') {
      options.output = argv[++i] || '';
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.output) {
    throw new Error('Missing required --output argument.');
  }

  return options;
}

function printUsage() {
  console.error(
    [
      'Usage:',
      '  node scripts/generate-march-backfill-pack.mjs --year 2026 --output data/problem-packs/march-2026.json'
    ].join('\n')
  );
}

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

function dateKey(year, monthIndex, day) {
  const d = new Date(Date.UTC(year, monthIndex, day));
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function defaultRubric() {
  return {
    version: 1,
    max_points: 7,
    criteria: [
      {
        id: 'setup',
        label: 'Key setup and useful observations',
        max_points: 2
      },
      {
        id: 'argument',
        label: 'Logical progression and valid proof steps',
        max_points: 3
      },
      {
        id: 'conclusion',
        label: 'Correct conclusion and edge-case handling',
        max_points: 2
      }
    ],
    hint_policy: {
      max_hints: 3,
      allow_final_answer: false,
      allow_full_proof: false
    }
  };
}

function buildMarchPack(year) {
  const monthIndex = 2; // March
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const sequence = buildSequence();
  const entries = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const item = sequence[(day - 1) % sequence.length];
    entries.push({
      date: dateKey(year, monthIndex, day),
      code: item.code,
      title: `IMO Shortlist 2023 ${item.topic} ${item.code}`,
      statement: `Solve IMO Shortlist 2023 ${item.code}. Write a full proof-based solution with clear claims and justification.`,
      source: `IMO Shortlist 2023, ${item.topic} (${item.code})`,
      topic: item.topic,
      answer_spec: {
        mode: 'proof',
        check_strategy: 'rubric-guided'
      },
      rubric: defaultRubric(),
      published: true
    });
  }

  return entries;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const pack = buildMarchPack(options.year);
    const payload = JSON.stringify(pack, null, 2);

    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, payload + '\n', 'utf8');
    console.log(`Wrote March backfill pack: ${options.output}`);
  } catch (error) {
    console.error(`Backfill generation failed: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

main();
