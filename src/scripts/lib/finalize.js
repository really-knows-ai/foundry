// scripts/lib/finalize.js
import { execFileSync } from 'node:child_process';
import { minimatch } from 'minimatch';
import { sortPaths } from './attestation/hash.js';

const TOOL_MANAGED = [
  'WORK.md',
  'WORK.history.yaml',
  'WORK.feedback.yaml',
];
const TOOL_MANAGED_PREFIX = ['.foundry/'];

// Accepts short (>=7) and full (<=64) hex SHAs. Rejects symbolic refs (HEAD),
// argument-injection (--upload-pack=...), and shell metacharacters. The
// practical attack surface is .foundry/active-stage.json and last-stage.json,
// which are persisted on disk and may be edited or corrupted; we validate
// here for defence-in-depth before passing the value to git.
const SHA_RE = /^[0-9a-f]{7,64}$/i;

function assertValidSha(baseSha) {
  if (typeof baseSha !== 'string' || !SHA_RE.test(baseSha)) {
    throw new Error(`invalid baseSha: ${JSON.stringify(baseSha)}`);
  }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd }).toString().split('\n').filter(Boolean);
}

function changedFiles(cwd, baseSha) {
  const tracked = git(cwd, ['diff', '--name-only', '--no-renames', baseSha, 'HEAD']);
  const diffUnstaged = git(cwd, ['diff', '--name-only', '--no-renames']);
  const diffStaged = git(cwd, ['diff', '--cached', '--name-only', '--no-renames']);
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...tracked, ...diffUnstaged, ...diffStaged, ...untracked])];
}

function isToolManaged(f) {
  if (TOOL_MANAGED.includes(f)) return true;
  return TOOL_MANAGED_PREFIX.some(p => f.startsWith(p));
}

export function finalizeStage({ cwd, baseSha, stageBase, cycleDef, artefactTypes, registerArtefact }) {
  assertValidSha(baseSha);
  const files = changedFiles(cwd, baseSha).filter(f => !isToolManaged(f));
  const allowedPatterns = stageBase === 'forge'
    ? (artefactTypes[cycleDef.outputArtefactType]?.filePatterns ?? [])
    : stageBase === 'assay'
      ? ['foundry-memory/**']
      : [];
  const unexpected = [];
  const matched = [];
  for (const f of files) {
    const hit = allowedPatterns.find(p => minimatch(f, p));
    if (hit) matched.push(f);
    else unexpected.push(f);
  }
  if (unexpected.length) return { ok: false, error: 'unexpected_files', files: unexpected };
  const sortedFiles = sortPaths(matched);
  // For non-forge stages, matched files are tool-managed side effects (e.g.
  // assay's memory writes) that should not become artefacts.
  if (stageBase !== 'forge') return { ok: true, artefacts: [], changedFiles: sortedFiles };
  const artefacts = sortedFiles.map(file => {
    registerArtefact({ file, type: cycleDef.outputArtefactType, status: 'draft' });
    return { file, type: cycleDef.outputArtefactType, status: 'draft' };
  });
  return { ok: true, artefacts, changedFiles: sortedFiles };
}
