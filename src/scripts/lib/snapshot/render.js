/**
 * Render a dry-run snapshot README.md from branch metadata, workfile, and trace.
 */

import { parseFrontmatter } from '../workfile.js';

function extractTimestamps(traceText) {
  const lines = traceText.split('\n').filter(l => l.length > 0);
  if (lines.length === 0) return { startedAt: null, finishedAt: null };

  const parseTs = (line) => {
    try {
      const obj = JSON.parse(line);
      return obj?.ts ?? null;
    } catch {
      return null;
    }
  };

  return {
    startedAt: parseTs(lines[0]),
    finishedAt: parseTs(lines[lines.length - 1]),
  };
}

function formatValue(v) {
  if (v === null || v === undefined) return 'null';
  return String(v);
}

export function renderReadme({ branch, parent, message, workfile, traceText }) {
  const fm = parseFrontmatter(workfile) || {};
  const { startedAt, finishedAt } = extractTimestamps(traceText);

  // JSON.stringify the goal string to produce YAML-safe quoted output.
  // Goals often contain colons, which would break YAML parsing without quotes.
  const goalRaw = fm.goal;
  const goalRendered = typeof goalRaw === 'string'
    ? JSON.stringify(goalRaw)
    : 'null';

  const lines = [
    '---',
    `branch: ${branch}`,
    `parent: ${parent}`,
    `flow: ${formatValue(fm.flow)}`,
    `goal: ${goalRendered}`,
    `startedAt: ${formatValue(startedAt)}`,
    `finishedAt: ${formatValue(finishedAt)}`,
    `exitReason: ${fm.status ?? 'unknown'}`,
    '---',
  ];

  return `${lines.join('\n')}\n\n# Dry-run snapshot\n\n${message}\n`;
}
