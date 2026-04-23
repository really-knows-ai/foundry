/**
 * Feedback parsing and manipulation utilities for WORK.md.
 */

import { extractAllTags } from './tags.js';
import { validateTransition, hashText } from './feedback-transitions.js';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parseFeedbackItem(line) {
  const item = { raw: line, state: 'unknown', tags: [], resolved: false };

  if (line.startsWith('- [ ]')) {
    item.state = 'open';
  } else if (line.startsWith('- [x]')) {
    item.state = 'actioned';
  } else if (line.startsWith('- [~]')) {
    item.state = 'wont-fix';
  }

  if (line.includes('| approved')) {
    item.resolved = true;
  } else if (line.includes('| rejected')) {
    item.state = 'rejected';
    item.resolved = false;
  }

  item.tags = extractAllTags(line);

  return item;
}

export function parseFeedback(text, cycle, artefacts) {
  const cycleFiles = new Set();
  for (const art of artefacts) {
    if (art.cycle === cycle) {
      cycleFiles.add(art.file || '');
    }
  }
  const filterByFile = cycleFiles.size > 0;

  const items = [];
  for (const it of walkFeedbackItems(text)) {
    if (!filterByFile || cycleFiles.has(it.file)) {
      items.push(parseFeedbackItem(it.trimmed));
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Manipulation
// ---------------------------------------------------------------------------

export function addFeedbackItem(text, file, itemText, tag) {
  // Dedup by (file, tag, text hash): if any existing item under this file
  // heading has the same tag and the same itemText, return without mutating.
  const existing = collectItemsForFile(text, file);
  const h = hashText(itemText);
  for (const ex of existing) {
    if (ex.tags.includes(`#${tag}`) && hashText(ex.coreText) === h) {
      return { text, deduped: true };
    }
  }

  const newItem = `- [ ] ${itemText} #${tag}`;
  const lines = text.split('\n');

  // Find ## Feedback section
  let feedbackIdx = -1;
  let feedbackLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (stripped === '## Feedback') {
      feedbackIdx = i;
      feedbackLevel = 2;
      break;
    }
    if (stripped === '# Feedback') {
      feedbackIdx = i;
      feedbackLevel = 1;
      break;
    }
  }

  const fileHeadingPrefix = feedbackLevel === 1 ? '## ' : '### ';
  const fileHeading = `${fileHeadingPrefix}${file}`;

  if (feedbackIdx === -1) {
    // No Feedback section — append one
    lines.push('', '## Feedback', '', `### ${file}`, newItem);
    return { text: lines.join('\n'), deduped: false };
  }

  // Find the file heading within the feedback section
  let fileIdx = -1;
  let sectionEnd = lines.length; // end of feedback section
  for (let i = feedbackIdx + 1; i < lines.length; i++) {
    const stripped = lines[i].trim();
    // Check if we've left the feedback section
    if (/^#{1,2} /.test(stripped)) {
      const level = stripped.startsWith('## ') ? 2 : 1;
      if (level <= feedbackLevel && stripped !== '# Feedback' && stripped !== '## Feedback') {
        sectionEnd = i;
        break;
      }
    }
    if (stripped === fileHeading.trim()) {
      fileIdx = i;
    }
  }

  if (fileIdx === -1) {
    // File heading doesn't exist — add it before section end
    lines.splice(sectionEnd, 0, '', fileHeading, newItem);
    return { text: lines.join('\n'), deduped: false };
  }

  // Find last item under this file heading
  let insertIdx = fileIdx + 1;
  for (let i = fileIdx + 1; i < sectionEnd; i++) {
    const stripped = lines[i].trim();
    if (stripped.startsWith(fileHeadingPrefix)) break; // next file heading
    if (/^- \[/.test(stripped)) {
      insertIdx = i + 1;
    }
  }

  lines.splice(insertIdx, 0, newItem);
  return { text: lines.join('\n'), deduped: false };
}

export function actionFeedbackItem(text, file, index, stageBase) {
  return transformFeedbackItemWithValidation(text, file, index, 'actioned', stageBase, (line) =>
    line.replace('- [ ]', '- [x]')
  );
}

export function wontfixFeedbackItem(text, file, index, reason, stageBase) {
  return transformFeedbackItemWithValidation(text, file, index, 'wont-fix', stageBase, (line) =>
    line.replace('- [ ]', '- [~]') + ` | wont-fix: ${reason}`
  );
}

export function resolveFeedbackItem(text, file, index, resolution, reason, stageBase) {
  return transformFeedbackItemWithValidation(text, file, index, resolution, stageBase, (line) => {
    if (resolution === 'approved') {
      return line + ' | approved';
    }
    return line + ` | rejected: ${reason}`;
  });
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export function listFeedback(text, cycle, artefacts, filterFile) {
  const cycleFiles = new Set();
  for (const art of artefacts) {
    if (art.cycle === cycle) {
      cycleFiles.add(art.file || '');
    }
  }
  const filterByCycle = cycleFiles.size > 0;

  const results = [];
  for (const it of walkFeedbackItems(text)) {
    if (filterByCycle && !cycleFiles.has(it.file)) continue;
    if (filterFile && filterFile !== it.file) continue;
    const parsed = parseFeedbackItem(it.trimmed);
    results.push({
      file: it.file,
      index: it.fileIndex,
      text: parsed.raw,
      state: parsed.state,
      tags: parsed.tags,
      resolved: parsed.resolved,
    });
  }
  return results;
}

/**
 * Detect feedback items stuck in a deadlock — rejected N or more times.
 * A deadlock occurs when forge-appraise cycles keep rejecting the same item.
 */
export function detectDeadlocks(feedback, history, threshold = 3) {
  // Count forge→appraise cycles (each pair = one iteration)
  const forgeAppraiseCount = history.filter(
    e => (e.stage || '').split(':')[0] === 'appraise'
  ).length;

  if (forgeAppraiseCount < threshold) return [];

  // Items that are still rejected after threshold iterations are deadlocked
  return feedback.filter(f => f.state === 'rejected' || f.state === 'open');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Collect feedback items under a specific file heading, returning the parsed
 * representation plus the "core text" (item body with tag and trailing resolution
 * stripped) for dedup hashing.
 */
function collectItemsForFile(text, file) {
  const items = [];
  for (const it of walkFeedbackItems(text)) {
    if (it.file !== file) continue;
    const parsed = parseFeedbackItem(it.trimmed);
    // Strip checkbox, tags, and trailing `| approved` / `| rejected: ...` /
    // `| wont-fix: ...` to get the core author-supplied text for dedup.
    let core = it.trimmed.replace(/^- \[[ x~]\]\s*/, '');
    core = core.replace(/\s*\|\s*(approved|rejected[^|]*|wont-fix[^|]*)\s*$/, '');
    for (const t of parsed.tags) {
      core = core.replace(t, '');
    }
    core = core.trim();
    items.push({ line: it.trimmed, state: parsed.state, tags: parsed.tags, coreText: core });
  }
  return items;
}

/**
 * Read the line at (file, index) and return its current feedback state
 * (or null if not found).
 */
function readItemState(text, file, index) {
  for (const it of walkFeedbackItems(text)) {
    if (it.file !== file) continue;
    if (it.fileIndex !== index) continue;
    const parsed = parseFeedbackItem(it.trimmed);
    // Map parseFeedbackItem's (state, resolved) pair onto state-machine states:
    // - `| approved` → terminal "approved"
    // - `| rejected` → "rejected" (parseFeedbackItem already sets this)
    // - bare `[x]`   → "actioned"
    // - bare `[~]`   → "wont-fix"
    // - bare `[ ]`   → "open"
    if (parsed.resolved) return 'approved';
    return parsed.state;
  }
  return null;
}

function transformFeedbackItemWithValidation(text, file, index, target, stageBase, transform) {
  if (stageBase !== undefined) {
    const current = readItemState(text, file, index);
    if (!current) {
      return { ok: false, error: `feedback item not found: file=${file} index=${index}` };
    }
    const v = validateTransition(current, target, stageBase);
    if (!v.ok) {
      return { ok: false, error: v.reason };
    }
    const updated = transformFeedbackItem(text, file, index, transform);
    return { ok: true, text: updated };
  }
  // Backward-compatible path: return plain string.
  return transformFeedbackItem(text, file, index, transform);
}

function transformFeedbackItem(text, file, index, transform) {
  const lines = text.split('\n');
  for (const it of walkFeedbackItems(text, lines)) {
    if (it.file !== file) continue;
    if (it.fileIndex !== index) continue;
    lines[it.lineIndex] = transform(lines[it.lineIndex]);
    return lines.join('\n');
  }
  return text;
}

/**
 * Walk every feedback item in `text`, yielding one record per checkbox line.
 *
 * Section-scope rules:
 *   - A `# Feedback` or `## Feedback` heading opens the section; its level
 *     (1 or 2) determines `feedbackLevel`.
 *   - File sub-headings are exactly one level deeper than the feedback heading
 *     (`## ` when level=1, `### ` when level=2). Entering a new file heading
 *     resets the per-file index to 0.
 *   - The section ends at any heading of level ≤ `feedbackLevel` that is not
 *     itself a `# Feedback` / `## Feedback` heading (guard against false exits
 *     when a nested doc re-uses the title).
 *
 * Yields: { trimmed, lineIndex, file, fileIndex } for each `- [ ]` / `- [x]` /
 *   `- [~]` line inside the section. `file` is `null` if no file heading has
 *   been seen yet. `lineIndex` is the 0-based position in the split input so
 *   callers can mutate `lines[lineIndex]` in place.
 *
 * Optional `lines` parameter lets the caller share the split array (avoids
 * re-splitting when the caller already holds one for mutation).
 */
function* walkFeedbackItems(text, lines) {
  const arr = lines || text.split('\n');
  let inFeedback = false;
  let feedbackLevel = 0;
  let currentFile = null;
  let fileIndex = 0;

  for (let i = 0; i < arr.length; i++) {
    const stripped = arr[i].trim();

    if (stripped === '# Feedback' || stripped === '## Feedback') {
      inFeedback = true;
      feedbackLevel = stripped.startsWith('## ') ? 2 : 1;
      continue;
    }

    if (inFeedback && /^#{1,2} /.test(stripped)) {
      const level = stripped.startsWith('## ') ? 2 : 1;
      if (level <= feedbackLevel && stripped !== '# Feedback' && stripped !== '## Feedback') {
        inFeedback = false;
        continue;
      }
    }

    if (!inFeedback) continue;

    const fileHeadingPrefix = feedbackLevel === 1 ? '## ' : '### ';
    if (stripped.startsWith(fileHeadingPrefix)) {
      currentFile = stripped.slice(fileHeadingPrefix.length).trim();
      fileIndex = 0;
      continue;
    }

    if (/^- \[/.test(stripped)) {
      yield { trimmed: stripped, lineIndex: i, file: currentFile, fileIndex };
      fileIndex++;
    }
  }
}
