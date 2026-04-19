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

export async function getLaws(foundryDir, typeId, io) {
  // Handle optional typeId: if typeId is the io object, shift args
  if (typeId && typeof typeId === 'object' && typeof typeId.exists === 'function') {
    io = typeId;
    typeId = null;
  }

  const laws = [];

  function parseLaws(text, source) {
    const lines = text.split('\n');
    let currentId = null;
    let currentLines = [];

    for (const line of lines) {
      const heading = line.match(/^## (.+)/);
      if (heading) {
        if (currentId) {
          laws.push({ id: currentId, text: currentLines.join('\n').trim(), source });
        }
        currentId = heading[1];
        currentLines = [];
      } else if (currentId) {
        currentLines.push(line);
      }
    }
    if (currentId) {
      laws.push({ id: currentId, text: currentLines.join('\n').trim(), source });
    }
  }

  // Global laws
  const globalDir = join(foundryDir, 'laws');
  if (await io.exists(globalDir)) {
    const files = await io.readDir(globalDir);
    const mdFiles = files.filter(f => f.endsWith('.md')).sort();
    for (const file of mdFiles) {
      const text = await io.readFile(join(globalDir, file));
      parseLaws(text, `laws/${file}`);
    }
  }

  // Type-specific laws
  if (typeId) {
    const typeLawsPath = join(foundryDir, 'artefacts', typeId, 'laws.md');
    if (await io.exists(typeLawsPath)) {
      const text = await io.readFile(typeLawsPath);
      parseLaws(text, `artefacts/${typeId}/laws.md`);
    }
  }

  return laws;
}

export async function getValidation(foundryDir, typeId, io) {
  const path = join(foundryDir, 'artefacts', typeId, 'validation.md');
  if (!(await io.exists(path))) {
    return null;
  }
  const text = await io.readFile(path);
  const entries = [];
  const lines = text.split('\n');
  let currentId = null;
  let currentCommand = null;
  let currentFailure = null;

  function flush() {
    if (currentId && currentCommand) {
      const entry = { id: currentId, command: currentCommand };
      if (currentFailure) entry.failureMeans = currentFailure;
      entries.push(entry);
    }
    currentId = null;
    currentCommand = null;
    currentFailure = null;
  }

  for (const line of lines) {
    const heading = line.match(/^## (.+)/);
    if (heading) {
      flush();
      currentId = heading[1].trim();
    } else if (currentId) {
      const cmdMatch = line.match(/^Command:\s*(.+)/);
      const failMatch = line.match(/^Failure means:\s*(.+)/);
      if (cmdMatch) currentCommand = cmdMatch[1].trim().replace(/^`|`$/g, '');
      if (failMatch) currentFailure = failMatch[1].trim();
    }
  }
  flush();
  return entries;
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

export async function selectAppraisers(foundryDir, typeId, countOverride, io) {
  // Handle optional countOverride
  if (countOverride && typeof countOverride === 'object' && typeof countOverride.exists === 'function') {
    io = countOverride;
    countOverride = null;
  }

  const { frontmatter } = await getArtefactType(foundryDir, typeId, io);
  const appraiserConfig = frontmatter.appraisers || {};
  const count = countOverride || appraiserConfig.count || 3;
  const allowed = appraiserConfig.allowed || null;

  const allAppraisers = await getAppraisers(foundryDir, io);
  let pool = allowed
    ? allAppraisers.filter(a => allowed.includes(a.id))
    : allAppraisers;

  if (pool.length === 0) return [];

  // Round-robin distribute
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push(pool[i % pool.length]);
  }
  return result;
}
