/**
 * Feedback parsing and manipulation utilities for WORK.md.
 */

import { extractAllTags } from './tags.js';

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
  let currentFile = null;
  let inFeedback = false;
  let feedbackLevel = 0;

  for (const line of text.split('\n')) {
    const stripped = line.trim();

    if (stripped === '# Feedback' || stripped === '## Feedback') {
      inFeedback = true;
      feedbackLevel = stripped.startsWith('## ') ? 2 : 1;
      continue;
    }

    // Exit feedback on a heading at the same or higher level
    if (inFeedback && /^#{1,2} /.test(stripped)) {
      const level = stripped.startsWith('## ') ? 2 : 1;
      if (level <= feedbackLevel && stripped !== '# Feedback' && stripped !== '## Feedback') {
        inFeedback = false;
        continue;
      }
    }

    if (!inFeedback) continue;

    // File sub-headings are one level below the Feedback heading
    const fileHeadingPrefix = feedbackLevel === 1 ? '## ' : '### ';
    if (stripped.startsWith(fileHeadingPrefix)) {
      currentFile = stripped.slice(fileHeadingPrefix.length).trim();
      continue;
    }

    if ((!filterByFile || cycleFiles.has(currentFile)) && /^- \[/.test(stripped)) {
      items.push(parseFeedbackItem(stripped));
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Manipulation
// ---------------------------------------------------------------------------

export function addFeedbackItem(text, file, itemText, tag) {
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
    return lines.join('\n');
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
    return lines.join('\n');
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
  return lines.join('\n');
}

export function actionFeedbackItem(text, file, index) {
  return transformFeedbackItem(text, file, index, (line) =>
    line.replace('- [ ]', '- [x]')
  );
}

export function wontfixFeedbackItem(text, file, index, reason) {
  return transformFeedbackItem(text, file, index, (line) =>
    line.replace('- [ ]', '- [~]') + ` | wont-fix: ${reason}`
  );
}

export function resolveFeedbackItem(text, file, index, resolution, reason) {
  return transformFeedbackItem(text, file, index, (line) => {
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
  let currentFile = null;
  let fileIndex = 0;
  let inFeedback = false;
  let feedbackLevel = 0;

  for (const line of text.split('\n')) {
    const stripped = line.trim();

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

    if ((!filterByCycle || cycleFiles.has(currentFile)) && /^- \[/.test(stripped)) {
      if (!filterFile || filterFile === currentFile) {
        const item = parseFeedbackItem(stripped);
        results.push({
          file: currentFile,
          index: fileIndex,
          text: item.raw,
          state: item.state,
          tags: item.tags,
          resolved: item.resolved,
        });
      }
      fileIndex++;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function transformFeedbackItem(text, file, index, transform) {
  const lines = text.split('\n');
  let inFeedback = false;
  let feedbackLevel = 0;
  let currentFile = null;
  let fileIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();

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

    if (currentFile === file && /^- \[/.test(stripped)) {
      if (fileIndex === index) {
        lines[i] = transform(lines[i]);
        return lines.join('\n');
      }
      fileIndex++;
    }
  }

  return text;
}
