import { dirname, join } from 'node:path';
import { validate } from '../config-validators/cycle.js';
import { commitWithPolicy } from '../git-bridge.js';

const KIND_HUMAN = 'cycle';
const KIND_UNDERSCORED = 'cycle';

function pathFor(name) {
  return join('foundry', 'cycles', `${name}.md`);
}

export async function create({ name, body, io, execFile }) {
  const v = await validate({ name, body, io });
  if (!v.ok) return { ok: false, errors: v.errors };

  const path = pathFor(name);
  if (await io.exists(path)) {
    return {
      ok: false,
      errors: [`${path} already exists; updates are not supported in 3.0.0 — edit by hand on this config/* branch`],
    };
  }

  await io.mkdirp(dirname(path));
  await io.writeFile(path, body);

  const sha = commitWithPolicy({
    message: `config: add ${KIND_HUMAN} ${name}\n\nvia foundry_config_create_${KIND_UNDERSCORED}`,
    allowedPatterns: ['foundry/**'],
    execFile,
  });
  return { ok: true, path, sha };
}
