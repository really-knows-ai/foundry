// scripts/lib/finalize.js
import { execSync } from 'node:child_process';
import { minimatch } from 'minimatch';

const TOOL_MANAGED = [
  'WORK.md',
  'WORK.history.yaml',
];
const TOOL_MANAGED_PREFIX = ['.foundry/'];

function changedFiles(cwd, baseSha) {
  const tracked = execSync(`git diff --name-only ${baseSha} HEAD`, { cwd }).toString().split('\n').filter(Boolean);
  const diffUnstaged = execSync('git diff --name-only', { cwd }).toString().split('\n').filter(Boolean);
  const untracked = execSync('git ls-files --others --exclude-standard', { cwd }).toString().split('\n').filter(Boolean);
  return [...new Set([...tracked, ...diffUnstaged, ...untracked])];
}

function isToolManaged(f) {
  if (TOOL_MANAGED.includes(f)) return true;
  return TOOL_MANAGED_PREFIX.some(p => f.startsWith(p));
}

export function finalizeStage({ cwd, baseSha, stageBase, cycleDef, artefactTypes, registerArtefact }) {
  const files = changedFiles(cwd, baseSha).filter(f => !isToolManaged(f));
  const allowedPatterns = stageBase === 'forge'
    ? (artefactTypes[cycleDef.outputArtefactType]?.filePatterns ?? [])
    : stageBase === 'assay'
      ? ['foundry/memory/**']
      : [];
  const unexpected = [];
  const matched = [];
  for (const f of files) {
    const hit = allowedPatterns.find(p => minimatch(f, p));
    if (hit) matched.push(f);
    else unexpected.push(f);
  }
  if (unexpected.length) return { ok: false, error: 'unexpected_files', files: unexpected };
  // For non-forge stages, matched files are tool-managed side effects (e.g.
  // assay's memory writes) that should not become artefacts.
  if (stageBase !== 'forge') return { ok: true, artefacts: [] };
  const artefacts = matched.map(file => {
    registerArtefact({ file, type: cycleDef.outputArtefactType, status: 'draft' });
    return { file, type: cycleDef.outputArtefactType, status: 'draft' };
  });
  return { ok: true, artefacts };
}
