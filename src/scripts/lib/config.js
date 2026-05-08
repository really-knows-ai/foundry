/**
 * Structured reads of foundry/ directory contents.
 */

import { join } from 'path';
import { parseFrontmatter } from './workfile.js';

function parseDoc(text) {
  const frontmatter = parseFrontmatter(text);
  const body = text.replace(/^---\n.+?\n---\n?/s, '').trim();
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
 */
function parseLaws(text, source) {
  const laws = [];
  const lines = text.split('\n');
  let currentId = null;
  const currentLines = [];

  function flush() {
    if (currentId) {
      laws.push({ id: currentId, text: currentLines.join('\n').trim(), source });
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

export async function getLaws(foundryDir, io, { typeId } = {}) {
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

function parseValidationEntry(line) {
  const cmdMatch = line.match(/^Command:\s*(.+)/);
  if (cmdMatch) return { type: 'command', value: cmdMatch[1].trim().replace(/^`|`$/g, '') };
  const failMatch = line.match(/^Failure means:\s*(.+)/);
  if (failMatch) return { type: 'failure', value: failMatch[1].trim() };
  return null;
}

function buildValidationEntry(currentId, currentCommand, currentFailure) {
  if (!currentId || !currentCommand) return null;
  const entry = { id: currentId, command: currentCommand };
  if (currentFailure) entry.failureMeans = currentFailure;
  return entry;
}

function flushValidationEntry(entries, id, command, failure) {
  const entry = buildValidationEntry(id, command, failure);
  if (entry) entries.push(entry);
}

function applyParsedEntry(state, parsed) {
  if (parsed?.type === 'command') state.command = parsed.value;
  if (parsed?.type === 'failure') state.failure = parsed.value;
}

function handleValidationLine(line, state) {
  const heading = line.match(/^## (.+)/);
  if (heading) {
    flushValidationEntry(state.entries, state.id, state.command, state.failure);
    state.id = heading[1].trim();
    state.command = null;
    state.failure = null;
    return;
  }
  if (state.id) {
    applyParsedEntry(state, parseValidationEntry(line));
  }
}

function parseValidationLines(lines) {
  const state = { entries: [], id: null, command: null, failure: null };
  for (const line of lines) {
    handleValidationLine(line, state);
  }
  flushValidationEntry(state.entries, state.id, state.command, state.failure);
  return state.entries;
}

export async function getValidation(foundryDir, typeId, io) {
  const path = join(foundryDir, 'artefacts', typeId, 'validation.md');
  if (!(await io.exists(path))) return null;
  const text = await io.readFile(path);
  return parseValidationLines(text.split('\n'));
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
