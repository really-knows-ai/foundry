#!/usr/bin/env node

/**
 * Validate feedback tags in WORK.md.
 *
 * Checks that every feedback item tag:
 *   1. Matches allowed syntax: #validation, #law:<id>, or #hitl
 *   2. For #law:<id>, the law id exists in foundry/laws/*.md or the
 *      relevant artefact type's laws.md
 *
 * Usage:
 *     node scripts/validate-tags.js [--work WORK.md] [--foundry-dir foundry]
 *
 * Exit 0 and prints "OK" if all tags are valid.
 * Exit 1 and prints invalid items to stderr otherwise.
 */

import { readFileSync, existsSync } from 'fs';
import { parseArgs } from 'util';
import { validateTags } from './lib/tags.js';

function main() {
  const { values } = parseArgs({
    options: {
      work: { type: 'string', default: 'WORK.md' },
      'foundry-dir': { type: 'string', default: 'foundry' },
    },
  });

  const workPath = values.work;
  const foundryDir = values['foundry-dir'];

  if (!existsSync(workPath)) {
    process.stderr.write('ERROR: WORK.md not found\n');
    process.exit(2);
  }

  const workText = readFileSync(workPath, 'utf-8');
  const errors = validateTags(workText, foundryDir);

  if (errors.length === 0) {
    console.log('OK');
    process.exit(0);
  }

  process.stderr.write(`Tag validation failed (${errors.length} issue${errors.length > 1 ? 's' : ''}):\n`);
  for (const err of errors) {
    process.stderr.write(`  line ${err.line}: ${err.message}\n`);
    process.stderr.write(`    ${err.raw}\n`);
  }
  process.exit(1);
}

main();
