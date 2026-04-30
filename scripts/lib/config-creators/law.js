import { dirname, join } from 'node:path';
import { validate } from '../config-validators/law.js';
import { commitWithPolicy } from '../git-bridge.js';

function pathFor(target) {
  if (target.kind === 'global') return join('foundry', 'laws', target.file);
  if (target.kind === 'type-specific')
    return join('foundry', 'artefacts', target.typeId, 'laws.md');
  throw new Error(`unknown law target kind: ${target.kind}`);
}

export async function create({ name, body, target, io, execFile }) {
  if (!target || typeof target !== 'object')
    return { ok: false, errors: ['target argument is required (object with kind + locator)'] };
  if (target.kind !== 'global' && target.kind !== 'type-specific')
    return { ok: false, errors: [`unknown target.kind: ${target.kind}`] };
  if (target.kind === 'global' && (typeof target.file !== 'string' || !target.file.trim()))
    return { ok: false, errors: ['target.file is required for kind: "global"'] };
  if (target.kind === 'type-specific' && (typeof target.typeId !== 'string' || !target.typeId.trim()))
    return { ok: false, errors: ['target.typeId is required for kind: "type-specific"'] };

  const v = await validate({ name, body, io });
  if (!v.ok) return { ok: false, errors: v.errors };

  const path = pathFor(target);
  if (await io.exists(path))
    return {
      ok: false,
      errors: [`${path} already exists; updates are not supported in 3.0.0 — edit by hand on this config/* branch`],
    };

  await io.mkdirp(dirname(path));
  await io.writeFile(path, body);

  const sha = commitWithPolicy({
    message: `config: add law ${name}\n\nvia foundry_config_create_law`,
    allowedPatterns: ['foundry/**'],
    execFile,
  });
  return { ok: true, path, sha };
}
