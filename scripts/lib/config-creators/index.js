import { dirname, join } from 'node:path';
import { commitWithPolicy } from '../git-bridge.js';

export function makeCreate(kindHuman, subdir, kindUnderscored) {
  const underscored = kindUnderscored || kindHuman.replace(/-/g, '_');
  const validatorModule = `../config-validators/${kindHuman}.js`;

  async function create({ name, body, io, execFile }) {
    const { validate } = await import(validatorModule);
    const v = await validate({ name, body, io });
    if (!v.ok) return { ok: false, errors: v.errors };

    const isArtefactType = subdir === 'foundry/artefacts';
    const path = isArtefactType
      ? join(subdir, name, 'definition.md')
      : join(subdir, `${name}.md`);

    if (await io.exists(path)) {
      return {
        ok: false,
        errors: [`${path} already exists; updates are not supported in 3.0.0 — edit by hand on this config/* branch`],
      };
    }

    await io.mkdirp(dirname(path));
    await io.writeFile(path, body);

    const sha = commitWithPolicy({
      message: `config: add ${kindHuman} ${name}\n\nvia foundry_config_create_${underscored}`,
      allowedPatterns: ['foundry/**'],
      execFile,
    });
    return { ok: true, path, sha };
  }

  return { create };
}