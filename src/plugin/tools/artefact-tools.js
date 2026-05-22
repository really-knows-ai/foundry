import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { getArtefactFiles } from '../../scripts/lib/artefacts.js';
import { getCycleDefinition } from '../../scripts/lib/config.js';
import { parseFrontmatter } from '../../scripts/lib/workfile.js';
import { makeIO } from './helpers.js';

function makeListTool(tool) {
  return tool({
    description: 'List artefact changes on the current work branch for the current cycle. Returns [{ file, state }] entries.',
    args: {},
    async execute(_args, context) {
      const foundryDir = 'foundry';
      const baseBranch = 'main';
      const workPath = path.join(context.worktree, 'WORK.md');
      if (!existsSync(workPath)) {
        return JSON.stringify({ error: 'WORK.md not found' });
      }

      const text = readFileSync(workPath, 'utf-8');
      const frontmatter = parseFrontmatter(text);
      const cycleId = frontmatter.cycle;
      if (!cycleId) {
        return JSON.stringify({ error: 'current cycle not found in WORK.md frontmatter' });
      }

      const io = makeIO(context.worktree);
      let cfm;
      try {
        cfm = (await getCycleDefinition(foundryDir, cycleId, io)).frontmatter || {};
      } catch (error) {
        return JSON.stringify({ error: error.message });
      }
      const outputType = cfm['output-type'];
      if (!outputType) {
        return JSON.stringify([]);
      }

      const artefacts = await getArtefactFiles(foundryDir, outputType, io, { baseBranch });
      return JSON.stringify(artefacts);
    },
  });
}

export function createArtefactTools({ tool }) {
  return {
    foundry_artefacts_list: makeListTool(tool),
  };
}
