#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function printUsage() {
  console.error(
    [
      'Usage:',
      '  node scripts/import-problem-pack.mjs --input <path> [--format json|csv] [--output <path>]',
      '',
      'Supported JSON shapes:',
      '  1) [{ date, code, title, statement, source, topic, answer_spec, rubric, published }]',
      '  2) [{ date, problem: { code, title, statement, source, topic, answer_spec, rubric }, published }]',
      '',
      'Supported CSV headers:',
      '  date,code,title,statement,source,topic,answer_spec_json,rubric_version,rubric_max_points,rubric_criteria_json,hint_policy_json,published'
    ].join('\n')
  );
}

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    input: '',
    format: '',
    output: ''
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') {
      options.input = argv[++i] || '';
      continue;
    }
    if (arg === '--format') {
      options.format = (argv[++i] || '').toLowerCase();
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
    fail(`Unknown argument: ${arg}`);
  }

  if (!options.input) {
    printUsage();
    fail('Missing required --input argument.');
  }

  return options;
}

function detectFormat(inputPath, explicitFormat) {
  if (explicitFormat) {
    if (explicitFormat === 'json' || explicitFormat === 'csv') {
      return explicitFormat;
    }
    fail(`Unsupported --format value: ${explicitFormat}`);
  }

  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.csv') return 'csv';

  fail(`Could not detect file format from extension: ${ext || '(none)'}. Pass --format json|csv.`);
}

function isValidDateKey(value) {
  if (!DATE_RE.test(value)) {
    return false;
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

function parseCsvRows(csvText) {
  const text = csvText.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    if (ch === '\r') {
      continue;
    }

    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function parseJsonOrThrow(value, label, index, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch (error) {
    fail(`Invalid JSON in ${label} at row ${index + 1}: ${error.message}`);
  }
}

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const raw = String(value).trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  fail(`Invalid boolean value: ${value}`);
}

function parseInteger(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    fail(`Invalid integer value: ${value}`);
  }
  return parsed;
}

function normalizeProblemRow(inputRow, index) {
  const row = inputRow.problem
    ? { ...inputRow.problem, date: inputRow.date, published: inputRow.published }
    : inputRow;

  const date = String(row.date || row.local_date || '').trim();
  const code = String(row.code || '').trim();
  const title = String(row.title || '').trim();
  const statement = String(row.statement || row.statement_md || '').trim();
  const source = String(row.source || '').trim();
  const topic = String(row.topic || 'General').trim();

  const answerSpec = parseJsonOrThrow(
    row.answer_spec ?? row.answerSpec ?? row.answer_spec_json,
    'answer_spec',
    index,
    {}
  );

  const rubricInput = row.rubric || {};
  const rubricVersion = parseInteger(
    rubricInput.version ?? row.rubric_version,
    1
  );
  const rubricMaxPoints = parseInteger(
    rubricInput.max_points ?? row.rubric_max_points,
    7
  );
  const rubricCriteria = parseJsonOrThrow(
    rubricInput.criteria ?? row.rubric_criteria ?? row.rubric_criteria_json,
    'rubric criteria',
    index,
    []
  );
  const hintPolicy = parseJsonOrThrow(
    rubricInput.hint_policy ?? row.hint_policy ?? row.hint_policy_json,
    'hint_policy',
    index,
    {}
  );

  const published = parseBoolean(row.published, true);

  if (!date) fail(`Missing date at row ${index + 1}`);
  if (!code) fail(`Missing code at row ${index + 1}`);
  if (!title) fail(`Missing title at row ${index + 1}`);
  if (!statement) fail(`Missing statement at row ${index + 1}`);
  if (!source) fail(`Missing source at row ${index + 1}`);
  if (!isValidDateKey(date)) fail(`Invalid date "${date}" at row ${index + 1}`);

  if (!Array.isArray(rubricCriteria)) {
    fail(`rubric criteria must be an array at row ${index + 1}`);
  }
  if (rubricVersion <= 0) {
    fail(`rubric_version must be > 0 at row ${index + 1}`);
  }
  if (rubricMaxPoints !== 7) {
    fail(`rubric_max_points must equal 7 at row ${index + 1}`);
  }

  return {
    date,
    code,
    title,
    statement,
    source,
    topic,
    answerSpec,
    rubric: {
      version: rubricVersion,
      maxPoints: rubricMaxPoints,
      criteria: rubricCriteria,
      hintPolicy
    },
    published
  };
}

function loadRows(inputPath, format) {
  const content = fs.readFileSync(inputPath, 'utf8');

  if (format === 'json') {
    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed) ? parsed : parsed.problems;
    if (!Array.isArray(items)) {
      fail('JSON input must be an array or an object with a "problems" array.');
    }
    return items.map((item, index) => normalizeProblemRow(item, index));
  }

  if (format === 'csv') {
    const rows = parseCsvRows(content);
    if (rows.length < 2) {
      fail('CSV must include a header row and at least one data row.');
    }

    const [headers, ...dataRows] = rows;
    const normalizedHeaders = headers.map((h) => h.trim());

    return dataRows
      .filter((row) => row.some((cell) => String(cell).trim().length > 0))
      .map((row, index) => {
        const objectRow = {};
        normalizedHeaders.forEach((header, headerIndex) => {
          objectRow[header] = row[headerIndex] ?? '';
        });
        return normalizeProblemRow(objectRow, index);
      });
  }

  fail(`Unsupported format: ${format}`);
}

function validateNoDuplicateDates(rows) {
  const seen = new Set();
  rows.forEach((row) => {
    if (seen.has(row.date)) {
      fail(`Duplicate scheduled date detected: ${row.date}`);
    }
    seen.add(row.date);
  });
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

function sqlBoolean(value) {
  return value ? 'TRUE' : 'FALSE';
}

function buildImportSql(rows, sourcePath) {
  const lines = [];
  lines.push('-- Generated by scripts/import-problem-pack.mjs');
  lines.push(`-- Source: ${sourcePath}`);
  lines.push('BEGIN;');
  lines.push('');

  rows.forEach((row) => {
    lines.push(`-- ${row.date} :: ${row.code}`);
    lines.push(
      [
        'INSERT INTO problems (code, title, statement_md, source, topic, answer_spec)',
        `VALUES (${sqlString(row.code)}, ${sqlString(row.title)}, ${sqlString(row.statement)}, ${sqlString(row.source)}, ${sqlString(row.topic)}, ${sqlJson(row.answerSpec)})`,
        'ON CONFLICT (code) DO UPDATE SET',
        '  title = EXCLUDED.title,',
        '  statement_md = EXCLUDED.statement_md,',
        '  source = EXCLUDED.source,',
        '  topic = EXCLUDED.topic,',
        '  answer_spec = EXCLUDED.answer_spec;'
      ].join('\n')
    );

    lines.push(
      [
        'INSERT INTO problem_rubrics (problem_id, version, max_points, criteria, hint_policy, is_active)',
        `SELECT id, ${row.rubric.version}, ${row.rubric.maxPoints}, ${sqlJson(row.rubric.criteria)}, ${sqlJson(row.rubric.hintPolicy)}, TRUE`,
        `FROM problems WHERE code = ${sqlString(row.code)}`,
        'ON CONFLICT (problem_id, version) DO UPDATE SET',
        '  max_points = EXCLUDED.max_points,',
        '  criteria = EXCLUDED.criteria,',
        '  hint_policy = EXCLUDED.hint_policy,',
        '  is_active = TRUE,',
        '  updated_at = NOW();'
      ].join('\n')
    );

    lines.push(
      [
        'UPDATE problem_rubrics',
        'SET is_active = FALSE, updated_at = NOW()',
        `WHERE problem_id = (SELECT id FROM problems WHERE code = ${sqlString(row.code)})`,
        `  AND version <> ${row.rubric.version};`
      ].join('\n')
    );

    lines.push(
      [
        'INSERT INTO problem_schedule (local_date, problem_id, published)',
        `SELECT DATE ${sqlString(row.date)}, id, ${sqlBoolean(row.published)}`,
        `FROM problems WHERE code = ${sqlString(row.code)}`,
        'ON CONFLICT (local_date) DO UPDATE SET',
        '  problem_id = EXCLUDED.problem_id,',
        '  published = EXCLUDED.published,',
        '  updated_at = NOW();'
      ].join('\n')
    );
    lines.push('');
  });

  lines.push('COMMIT;');
  lines.push('');
  return lines.join('\n');
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const format = detectFormat(options.input, options.format);
    const rows = loadRows(options.input, format);
    validateNoDuplicateDates(rows);

    const sql = buildImportSql(rows, options.input);

    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, sql, 'utf8');
      console.log(`Wrote SQL import script to ${options.output}`);
      return;
    }

    process.stdout.write(sql);
  } catch (error) {
    console.error(`Import failed: ${error.message}`);
    process.exit(1);
  }
}

main();
