/**
 * Structured reads of foundry/ directory contents.
 */

import { join } from 'path';
import { parseFrontmatter } from './workfile.js';
import matter from 'gray-matter';

function parseDoc(text) {
  const frontmatter = parseFrontmatter(text);
  const body = matter(text).content.trim();
  return { frontmatter, body };
}

export async function getCycleDefinition(foundryDir, cycleId, io) {
  const path = join(foundryDir, 'cycles', `${cycleId}.md`);
  if (!(await io.exists(path))) {
    throw new Error(`Cycle not found: ${cycleId}`);
  }
  const text = await io.readFile(path);
  return parseDoc(text);
}

export async function getArtefactType(foundryDir, typeId, io) {
  const path = join(foundryDir, 'artefacts', typeId, 'definition.md');
  if (!(await io.exists(path))) {
    throw new Error(`Artefact type not found: ${typeId}`);
  }
  const text = await io.readFile(path);
  return parseDoc(text);
}

/**
 * Parse law entries from a markdown file. Each `## heading` starts a new law.
 * Each law may have an optional `validators:` block with entries containing id, command, and optional failure-means.
 * Validators are extracted and returned separately from prose.
 * Returns: [{id, text (prose only), validators (if present)}]
 */
function parseLaws(text, source) {
  const laws = [];
  const lines = text.split('\n');
  let currentId = null;
  const currentLines = [];

  function flush() {
    if (currentId) {
      const lawText = currentLines.join('\n').trim();
      const { prose, validators } = extractValidators(lawText, currentId);
      const lawObj = { id: currentId, text: prose };
      if (validators && validators.length > 0) {
        lawObj.validators = validators;
      }
      laws.push(lawObj);
    }
  }

  for (const line of lines) {
    const heading = line.match(/^## (.+)/);
    if (heading) {
      flush();
      currentId = heading[1];
      currentLines.length = 0;
    } else if (currentId) {
      currentLines.push(line);
    }
  }
  flush();
  return laws;
}

/**
 * Extract validators block from law text and return prose-only text plus parsed validators.
 * @param {string} lawText - Full law text including optional validators block
 * @param {string} lawId - Law ID for error messages
 * @returns {{prose: string, validators: Array}} - Prose text and validators array
 * @throws {Error} if validators block is malformed
 */
function extractValidators(lawText, lawId) {
  // Find validators: block (must start at beginning of line, followed by indented lines)
  // The pattern captures lines starting with spaces/tabs (indented content)
  // Using possessive quantifier to avoid backtracking: (?:...)+ instead of (...)*.
  const validatorBlockMatch = lawText.match(/^validators:\n((?:[ \t]+\S.*(?:\n|$))*)/m);
  
  if (!validatorBlockMatch || !validatorBlockMatch[1].trim()) {
    return { prose: lawText, validators: null };
  }

  // Extract prose (everything before validators:)
  const prose = lawText.substring(0, validatorBlockMatch.index).trim();
  
  // Extract and parse validators block
  const validatorBlockText = validatorBlockMatch[1];
  const validators = parseValidatorBlock(validatorBlockText, lawId);
  
  return { prose, validators };
}

/**
 * Parse a validator entry from lines.
 * @param {string} lawId - Law ID for error messages
 * @param {Set} seenIds - Set of seen validator IDs to detect duplicates
 * @param {object} validator - Validator object being built
 * @throws {Error} if validator is invalid
 */
function saveValidator(validator, seenIds, lawId) {
  validateValidator(validator, seenIds, lawId);
  return validator;
}

/**
 * Parse field from a line: key: value
 * @param {string} line - Line to parse
 * @param {string} key - Field key to match
 * @returns {string|null} - Field value or null
 */
function parseField(line, key) {
  const match = line.match(new RegExp(`^\\s*${key}:\\s*(.+)`));
  return match ? match[1].trim() : null;
}

/**
 * Handle a new validator entry line.
 * @param {object} currentValidator - Current validator object or null
 * @param {Array} validators - List to add saved validators to
 * @param {string} line - Line to process
 * @param {Set} seenIds - Set of seen IDs
 * @param {string} lawId - Law ID for error messages
 * @returns {object} - New validator object or null
 */
function handleValidatorEntry(currentValidator, validators, line, seenIds, lawId) {
  const entryMatch = line.match(/^\s*-\s*id:\s*(.+)/);
  if (entryMatch) {
    // Save previous validator if exists
    if (currentValidator) {
      validators.push(saveValidator(currentValidator, seenIds, lawId));
    }
    return { id: entryMatch[1].trim() };
  }
  return null;
}

/**
 * Process a field line in a validator entry.
 * @param {object} validator - Current validator object
 * @param {string} line - Line to process
 */
function processValidatorField(validator, line) {
  const command = parseField(line, 'command');
  if (command !== null) {
    validator.command = command;
    return;
  }

  const failureMeans = parseField(line, 'failure-means');
  if (failureMeans !== null) {
    validator['failure-means'] = failureMeans;
  }
}

/**
 * Process a single line in the validators block.
 * @param {object} currentValidator - Current validator or null
 * @param {string} line - Line to process
 * @param {string} lawId - Law ID for error messages
 * @throws {Error} if validator entry not started
 */
function processValidatorLine(currentValidator, line, lawId) {
  if (!currentValidator) {
    throw new Error(`law "${lawId}": validator entry missing required 'id'`);
  }
  processValidatorField(currentValidator, line);
}

/**
 * Parse the validators block content (YAML-like format)
 * @param {string} blockText - Text content of validators block
 * @param {string} lawId - Law ID for error messages
 * @returns {Array} - Array of parsed validators
 * @throws {Error} if validators are malformed
 */
function parseValidatorBlock(blockText, lawId) {
  const validators = [];
  const lines = blockText.split('\n');
  let currentValidator = null;
  const seenIds = new Set();

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;
    
    // Check for new validator entry (starts with -)
    const newValidator = handleValidatorEntry(currentValidator, validators, line, seenIds, lawId);
    if (newValidator) {
      currentValidator = newValidator;
      continue;
    }

    processValidatorLine(currentValidator, line, lawId);
  }

  // Save last validator
  if (currentValidator) {
    validators.push(saveValidator(currentValidator, seenIds, lawId));
  }

  return validators;
}

/**
 * Validate a single validator entry.
 * @param {object} validator - Validator object with id, command, and optional failure-means
 * @param {Set} seenIds - Set of seen validator IDs to detect duplicates
 * @param {string} lawId - Law ID for error messages
 * @throws {Error} if validator is invalid
 */
function validateValidator(validator, seenIds, lawId) {
  if (!validator.id) {
    throw new Error(`law "${lawId}": validator entry missing required 'id'`);
  }
  if (!validator.command) {
    throw new Error(`law "${lawId}": validator entry missing required 'command'`);
  }
  if (seenIds.has(validator.id)) {
    throw new Error(`law "${lawId}": duplicate validator id '${validator.id}' in law`);
  }
  seenIds.add(validator.id);
}

async function collectLawsFromDir(dir, io, sourcePrefix) {
  if (!(await io.exists(dir))) return [];
  const files = await io.readDir(dir);
  const mdFiles = files.filter(f => f.endsWith('.md')).sort();
  const results = [];
  for (const file of mdFiles) {
    const text = await io.readFile(join(dir, file));
    results.push(...parseLaws(text, `${sourcePrefix}/${file}`));
  }
  return results;
}

/**
 * Collect all laws (global and type-specific) for a given artefact type.
 * Returns laws with their source and validator information.
 */
async function collectAllLaws(foundryDir, io, { typeId } = {}) {
  const laws = await collectLawsFromDir(join(foundryDir, 'laws'), io, 'laws');

  if (typeId) {
    const typeLawsPath = join(foundryDir, 'artefacts', typeId, 'laws.md');
    if (await io.exists(typeLawsPath)) {
      const text = await io.readFile(typeLawsPath);
      laws.push(...parseLaws(text, `artefacts/${typeId}/laws.md`));
    }
  }

  return laws;
}

export async function getLaws(foundryDir, io, { typeId } = {}) {
  const laws = await collectAllLaws(foundryDir, io, { typeId });

  // Return prose-only without source or validators
  return laws.map(law => ({ id: law.id, text: law.text }));
}

export async function getLawsForQuench(foundryDir, io, { typeId } = {}) {
  const laws = await collectAllLaws(foundryDir, io, { typeId });

  // Return only laws that have validators
  return laws.filter(law => law.validators && law.validators.length > 0);
}

export async function getAppraisers(foundryDir, io) {
  const dir = join(foundryDir, 'appraisers');
  if (!(await io.exists(dir))) return [];
  const files = await io.readDir(dir);
  const mdFiles = files.filter(f => f.endsWith('.md')).sort();
  const result = [];
  for (const file of mdFiles) {
    const text = await io.readFile(join(dir, file));
    const { frontmatter, body } = parseDoc(text);
    const entry = { id: frontmatter.id, personality: body };
    if (frontmatter.model) entry.model = frontmatter.model;
    result.push(entry);
  }
  return result;
}

export async function getFlow(foundryDir, flowId, io) {
  const path = join(foundryDir, 'flows', `${flowId}.md`);
  if (!(await io.exists(path))) {
    throw new Error(`Flow not found: ${flowId}`);
  }
  const text = await io.readFile(path);
  return parseDoc(text);
}

function buildAppraiserPool(allAppraisers, allowed) {
  return allowed ? allAppraisers.filter(a => allowed.includes(a.id)) : allAppraisers;
}

function roundRobinSelect(pool, count) {
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push(pool[i % pool.length]);
  }
  return result;
}

function resolveAppraiserConfig(frontmatter, countOverride) {
  const appraiserConfig = frontmatter.appraisers || {};
  return {
    count: countOverride || appraiserConfig.count || 3,
    allowed: appraiserConfig.allowed || null,
  };
}

export async function selectAppraisers(foundryDir, typeId, { io, countOverride } = {}) {
  if (!io) throw new Error('selectAppraisers: io is required');

  const { frontmatter } = await getArtefactType(foundryDir, typeId, io);
  const { count, allowed } = resolveAppraiserConfig(frontmatter, countOverride);

  const allAppraisers = await getAppraisers(foundryDir, io);
  const pool = buildAppraiserPool(allAppraisers, allowed);
  if (pool.length === 0) return [];

  return roundRobinSelect(pool, count);
}
