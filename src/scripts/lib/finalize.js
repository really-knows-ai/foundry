// scripts/lib/finalize.js
import { minimatch } from 'minimatch';
import { sortPaths } from './attestation/hash.js';
import { isToolManaged } from './git-policy.js';

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

function git(exec, args) {
  return exec(['git', ...args]).toString().split('\n').filter(Boolean);
}

function changedFiles(exec, baseSha) {
  const tracked = git(exec, ['diff', '--name-only', '--no-renames', baseSha, 'HEAD']);
  const diffUnstaged = git(exec, ['diff', '--name-only', '--no-renames']);
  const diffStaged = git(exec, ['diff', '--cached', '--name-only', '--no-renames']);
  const untracked = git(exec, ['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...tracked, ...diffUnstaged, ...diffStaged, ...untracked])];
}

function getAllowedPatterns(stageBase, cycleDef, artefactTypes) {
  if (stageBase === 'forge') {
    return artefactTypes[cycleDef.outputArtefactType]?.filePatterns ?? [];
  }
  if (stageBase === 'assay') {
    return ['foundry-memory/**'];
  }
  return [];
}

function classifyFiles(files, allowedPatterns) {
  const unexpected = [];
  const matched = [];
  for (const f of files) {
    const hit = allowedPatterns.find(p => minimatch(f, p));
    if (hit) matched.push(f);
    else unexpected.push(f);
  }
  return { matched, unexpected };
}

export function finalizeStage({ cwd, baseSha, stageBase, cycleDef, artefactTypes, io, artefact_version }) {
  if (!io?.exec) {
    throw new Error('finalizeStage: io.exec is required');
  }
  assertValidSha(baseSha);
  const files = changedFiles(io.exec, baseSha).filter(f => !isToolManaged(f));
  const allowedPatterns = getAllowedPatterns(stageBase, cycleDef, artefactTypes);
  const { matched, unexpected } = classifyFiles(files, allowedPatterns);
  if (unexpected.length) return { ok: false, error: 'unexpected_files', files: unexpected };
  const sortedFiles = sortPaths(matched);
  // For non-forge stages, matched files are tool-managed side effects
  // (e.g. assay's memory writes) that should not become artefacts.
  if (stageBase !== 'forge') return { ok: true, artefacts: [], changedFiles: sortedFiles };
  const artefacts = sortedFiles.map(file => ({
    file,
    type: cycleDef.outputArtefactType,
  }));
  return forgeResult(artefacts, sortedFiles, artefact_version);
}

function forgeResult(artefacts, files, artefact_version) {
  const result = { ok: true, artefacts, changedFiles: files };
  if (artefact_version !== undefined) {
    result.artefact_version = artefact_version;
  }
  return result;
}
