/**
 * Coverage-building helpers for the appraise stage.
 *
 * Builds per-unit completion coverage from dispatch results, counts
 * violations from stage-output files, and serialises the coverage map
 * to disk.
 */

// ---------------------------------------------------------------------------
// Law-unit lookup
// ---------------------------------------------------------------------------

function findLawUnit(units, record) {
  for (const unit of units) {
    if (unit.lawIds && unit.lawIds.includes(record.law)) {
      return unit.unitId;
    }
  }
  return undefined;
}

/**
 * Map a violation record to the unitId of the evaluation unit that produced it.
 * Bundle mode maps all violations to the single bundle unit.
 * Law-by-law mode finds the unit whose lawIds include the record's law.
 */
export function recordToUnitId(record, unitsByGroup) {
  const units = unitsByGroup.get(record.group);
  if (!units || units.length === 0) return undefined;
  if (units.length === 1 && units[0].mode === 'bundle') return units[0].unitId;
  return findLawUnit(units, record);
}

// ---------------------------------------------------------------------------
// Violation counting
// ---------------------------------------------------------------------------

function tryParseLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function countViolationsInContent(content, unitsByGroup, coverage) {
  for (const line of content.trim().split('\n').filter(Boolean)) {
    const record = tryParseLine(line);
    if (!record) continue;
    const unitId = recordToUnitId(record, unitsByGroup);
    if (unitId && coverage.has(unitId)) {
      coverage.get(unitId).violations++;
    }
  }
}

function countViolationsFromFiles(filePaths, io, unitsByGroup, coverage) {
  for (const fp of filePaths) {
    let content;
    try { content = io.readFile(fp); } catch { continue; }
    countViolationsInContent(content, unitsByGroup, coverage);
  }
}

// ---------------------------------------------------------------------------
// Coverage building
// ---------------------------------------------------------------------------

function createCoverageEntry(entry) {
  return {
    unitId: entry.unit.unitId,
    group: entry.group,
    mode: entry.unit.mode,
    law: entry.unit.mode === 'law-by-law' ? (entry.unit.lawIds?.[0] || null) : null,
    evaluations: [],
    violations: 0,
  };
}

function processDispatchEntry(entry, i, settled, coverage) {
  const result = settled[i];
  const unitId = entry.unit.unitId;

  if (!coverage.has(unitId)) {
    coverage.set(unitId, createCoverageEntry(entry));
  }

  coverage.get(unitId).evaluations.push({
    appraiser: entry.appraiser.id,
    verdict: entry.pass ? 'passed' : 'failed',
    completed: result.status === 'fulfilled',
  });
}

/**
 * Build per-unit completion coverage from dispatch results and stage outputs.
 * A fulfilled dispatch is a completed evaluation; a rejected dispatch is
 * uncompleted.
 */
export function buildCompletionCoverage(dispatchMatrix, settled, filePaths, io, unitsByGroup) {
  const coverage = new Map();

  dispatchMatrix.forEach(function(entry, i) {
    processDispatchEntry(entry, i, settled, coverage);
  });

  countViolationsFromFiles(filePaths, io, unitsByGroup, coverage);

  return coverage;
}

/**
 * Serialise coverage data to a JSON file for the attestation tool.
 */
export function writeCoverageFile(io, coverage, cycleId) {
  const entries = [...coverage.entries()]
    .sort(function(a, b) { return a[0].localeCompare(b[0]); })
    .map(function([unitId, entry]) {
      return { unitId: unitId, ...entry };
    });
  const json = JSON.stringify(entries, null, 2) + '\n';
  io.writeFile('foundry/.stage/.coverage-' + cycleId + '.json', json);
}
