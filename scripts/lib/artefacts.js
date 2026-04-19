/**
 * Artefacts table utilities for WORK.md.
 *
 * Parses, adds rows to, and updates status in the markdown artefacts table.
 */

/**
 * Parse the artefacts markdown table from text.
 * @param {string} text
 * @returns {Array<{file: string, type: string, cycle: string, status: string}>}
 */
export function parseArtefactsTable(text) {
  const artefacts = [];
  let inTable = false;

  for (const line of text.split('\n')) {
    const stripped = line.trim();

    if (stripped.startsWith('| File')) {
      inTable = true;
      continue;
    }
    if (inTable && stripped.startsWith('|---')) {
      continue;
    }
    if (inTable && stripped.startsWith('|')) {
      const cols = stripped.split('|').slice(1, -1).map(c => c.trim());
      if (cols.length >= 4) {
        artefacts.push({
          file: cols[0],
          type: cols[1],
          cycle: cols[2],
          status: cols[3],
        });
      }
    } else if (inTable) {
      inTable = false;
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
  let lastTableRow = -1;
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (stripped.startsWith('| File')) {
      inTable = true;
      continue;
    }
    if (inTable && stripped.startsWith('|---')) {
      if (lastTableRow < 0) lastTableRow = i; // insert after separator if no data rows
      continue;
    }
    if (inTable && stripped.startsWith('|')) {
      lastTableRow = i;
    } else if (inTable) {
      break;
    }
  }

  if (lastTableRow === -1) {
    throw new Error('Artefacts table not found');
  }

  const newRow = `| ${file} | ${type} | ${cycle} | ${status} |`;
  lines.splice(lastTableRow + 1, 0, newRow);
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
  if (newStatus === 'draft') {
    throw new Error('status draft not permitted; use stage_finalize for registration');
  }
  if (!['done', 'blocked'].includes(newStatus)) {
    throw new Error(`invalid status: ${newStatus}`);
  }
  const lines = text.split('\n');
  let inTable = false;
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (stripped.startsWith('| File')) {
      inTable = true;
      continue;
    }
    if (inTable && stripped.startsWith('|---')) continue;
    if (inTable && stripped.startsWith('|')) {
      const cols = stripped.split('|').slice(1, -1).map(c => c.trim());
      if (cols.length >= 4 && cols[0] === file) {
        cols[3] = newStatus;
        lines[i] = '| ' + cols.join(' | ') + ' |';
        found = true;
        break;
      }
    } else if (inTable) {
      break;
    }
  }

  if (!found) {
    throw new Error(`File not found in artefacts table: ${file}`);
  }

  return lines.join('\n');
}
