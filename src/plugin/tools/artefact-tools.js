import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { getArtefactFiles } from '../../scripts/lib/artefacts.js';
import { getCycleDefinition } from '../../scripts/lib/config.js';
import { parseFrontmatter } from '../../scripts/lib/workfile.js';
import { guarded, notFailedGuard } from '../../scripts/lib/guards.js';
import { makeIO, flowBranchGuard, branchIoFactory, asyncIoFactory } from './helpers.js';

const gateNotFailed = notFailedGuard(makeIO);

const FLOW_GUARDS = [flowBranchGuard, gateNotFailed];

function readWorkCycleId(worktree) {
  const workPath = path.join(worktree, 'WORK.md');
  if (!existsSync(workPath)) throw new Error('WORK.md not found');
  const frontmatter = parseFrontmatter(readFileSync(workPath, 'utf-8'));
  if (!frontmatter.cycle) throw new Error('current cycle not found in WORK.md frontmatter');
  return frontmatter.cycle;
}

async function readOutputType(foundryDir, cycleId, io) {
  let cd;
  try {
    cd = await getCycleDefinition(foundryDir, cycleId, io);
  } catch { return null; }
  return cd.frontmatter && cd.frontmatter['output-type'];
}

async function executeArtefactList(_args, context) {
  try {
    const cycleId = readWorkCycleId(context.worktree);
    const io = makeIO(context.worktree);
    const outputType = await readOutputType('foundry', cycleId, io);
    if (!outputType) return JSON.stringify([]);
    const artefacts = await getArtefactFiles('foundry', outputType, io, { baseBranch: 'main' });
    return JSON.stringify(artefacts);
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}

export function createArtefactTools({ tool }) {
  return {
    foundry_artefact_list: tool({
      description: 'List artefact changes on the current work branch for the current cycle. Returns [{ file, state }] entries.',
      args: {},
      execute: guarded('foundry_artefact_list', FLOW_GUARDS, executeArtefactList, { branchIo: branchIoFactory, io: asyncIoFactory }),
    }),
  };
}
