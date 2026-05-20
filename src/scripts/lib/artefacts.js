/**
 * Artefacts table utilities for WORK.md.
 *
 * Parses, adds rows to, and updates status in the markdown artefacts table.
 */

// --- Table line classifiers ---

function isTableHeader(line) {
  return line.startsWith('| File');
}

function isTableSeparator(line) {
  return line.startsWith('|---');
}

function isTableRow(line) {
  return line.startsWith('|');
}

function parseTableRow(line) {
  const cols = line.split('|').slice(1, -1).map(c => c.trim());
  return cols.length >= 4 ? cols : null;
}

// --- Status validation ---

function validateStatus(newStatus) {
  if (newStatus === 'draft') {
    throw new Error('status draft not permitted; artefacts are registered automatically during orchestration');
  }
  if (!['done', 'blocked'].includes(newStatus)) {
    throw new Error(`invalid status: ${newStatus}`);
  }
}

// --- Table boundary detection ---

function findTableHeader(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (isTableHeader(lines[i].trim())) return i;
  }
  return -1;
}

function findTableSeparator(lines, afterIdx) {
  for (let i = afterIdx + 1; i < lines.length; i++) {
    if (isTableSeparator(lines[i].trim())) return i;
  }
  return -1;
}

function getTableBounds(lines) {
  const headerIdx = findTableHeader(lines);
  if (headerIdx < 0) return null;
  const sepIdx = findTableSeparator(lines, headerIdx);
  if (sepIdx < 0) return null;
  return { headerIdx, sepIdx };
}

function findTableEnd(lines, startIdx) {
  for (let i = startIdx; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (!isTableRow(stripped)) return i;
  }
  return lines.length;
}

function formatTableRow(cols) {
  return '| ' + cols.join(' | ') + ' |';
}

/**
 * Parse the artefacts markdown table from text.
 * @param {string} text
 * @returns {Array<{file: string, type: string, cycle: string, status: string}>}
 */
export function parseArtefactsTable(text) {
  const lines = text.split('\n');
  const bounds = getTableBounds(lines);
  if (!bounds) return [];

  const artefacts = [];
  const endIdx = findTableEnd(lines, bounds.sepIdx + 1);

  for (let i = bounds.sepIdx + 1; i < endIdx; i++) {
    const cols = parseTableRow(lines[i].trim());
    if (cols) {
      artefacts.push({
        file: cols[0],
        type: cols[1],
        cycle: cols[2],
        status: cols[3],
      });
    }
  }

  return artefacts;
}

/**
 * Add a row to the artefacts table.
 * @param {string} text - Full WORK.md text
 * @param {{file: string, type: string, cycle: string, status: string}} row
 * @returns {string} Updated text
 */
export function addArtefactRow(text, { file, type, cycle, status }) {
  const lines = text.split('\n');
  const bounds = getTableBounds(lines);

  if (!bounds) {
    throw new Error('Artefacts table not found');
  }

  const endIdx = findTableEnd(lines, bounds.sepIdx + 1);
  const insertAt = endIdx > bounds.sepIdx + 1 ? endIdx - 1 : bounds.sepIdx;
  const newRow = `| ${file} | ${type} | ${cycle} | ${status} |`;
  lines.splice(insertAt + 1, 0, newRow);
  return lines.join('\n');
}

/**
 * Update the status column for a specific file in the artefacts table.
 * @param {string} text - Full WORK.md text
 * @param {string} file - File name to match
 * @param {string} newStatus - New status value
 * @returns {string} Updated text
 */
export function setArtefactStatus(text, file, newStatus) {
  validateStatus(newStatus);

  const lines = text.split('\n');
  const bounds = getTableBounds(lines);

  if (!bounds) {
    throw new Error(`File not found in artefacts table: ${file}`);
  }

  const endIdx = findTableEnd(lines, bounds.sepIdx + 1);

  for (let i = bounds.sepIdx + 1; i < endIdx; i++) {
    const cols = parseTableRow(lines[i].trim());
    if (cols && cols[0] === file) {
      cols[3] = newStatus;
      lines[i] = formatTableRow(cols);
      return lines.join('\n');
    }
  }

  throw new Error(`File not found in artefacts table: ${file}`);
}

/**
 * Get draft artefacts for a specific cycle from the artefacts table.
 * @param {string} cycleId - Cycle ID to filter by
 * @param {object} io - IO interface
 * @returns {Array<{file: string, type: string, cycle: string, status: string}>}
 */
export function getArtefactsForCycle(cycleId, io) {
  const text = io.readFile('WORK.md');
  const artefacts = parseArtefactsTable(text);
  return artefacts.filter(a => a.cycle === cycleId && a.status === 'draft');
}
