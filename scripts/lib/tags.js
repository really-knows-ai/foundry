/**
 * Shared tag validation utilities used by sort.js and validate-tags.js.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VALID_TAG_RE = /^(#validation|#hitl|#law:[\w-]+)$/;

// ---------------------------------------------------------------------------
// Law collection
// ---------------------------------------------------------------------------

export function collectLawIds(foundryDir) {
  const ids = new Set();

  const lawsDir = join(foundryDir, 'laws');
  if (existsSync(lawsDir)) {
    for (const file of readdirSync(lawsDir)) {
      if (!file.endsWith('.md')) continue;
      const text = readFileSync(join(lawsDir, file), 'utf-8');
      for (const id of extractLawHeadings(text)) ids.add(id);
    }
  }

  const artefactsDir = join(foundryDir, 'artefacts');
  if (existsSync(artefactsDir)) {
    for (const typeDir of readdirSync(artefactsDir)) {
      const lawsPath = join(artefactsDir, typeDir, 'laws.md');
      if (!existsSync(lawsPath)) continue;
      const text = readFileSync(lawsPath, 'utf-8');
      for (const id of extractLawHeadings(text)) ids.add(id);
    }
  }

  return ids;
}

export function extractLawHeadings(text) {
  const ids = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^## (.+)$/);
    if (match) ids.push(match[1].trim());
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Tag extraction
// ---------------------------------------------------------------------------

/**
 * Extract all hash-tags from a feedback line.
 * Returns an array of strings like ['#validation', '#law:brevity'].
 */
export function extractAllTags(line) {
  return (line.match(/#[\w][\w:-]*/g) || []);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate all feedback tags in the Feedback section of WORK.md text.
 *
 * Returns an array of error strings. Empty array = all valid.
 */
export function validateTags(workText, foundryDir) {
  const lawIds = collectLawIds(foundryDir);
  const errors = [];
  let inFeedback = false;
  let lineNum = 0;

  for (const line of workText.split('\n')) {
    lineNum++;
    const stripped = line.trim();

    if (stripped === '# Feedback') { inFeedback = true; continue; }
    if (inFeedback && stripped.startsWith('# ') && stripped !== '# Feedback') {
      inFeedback = false; continue;
    }
    if (!inFeedback || !(/^- \[/.test(stripped))) continue;

    const tags = extractAllTags(stripped);
    if (tags.length === 0) {
      errors.push({ line: lineNum, message: 'Feedback item has no tag', raw: stripped });
      continue;
    }

    for (const tag of tags) {
      if (!VALID_TAG_RE.test(tag)) {
        errors.push({ line: lineNum, message: `Unknown tag: ${tag}`, raw: stripped });
      } else if (tag.startsWith('#law:')) {
        const lawId = tag.slice(5);
        if (!lawIds.has(lawId)) {
          errors.push({ line: lineNum, message: `Law not found: ${lawId}`, raw: stripped });
        }
      }
    }
  }

  return errors;
}
