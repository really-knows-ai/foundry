import { dirname } from 'node:path';
import { commitWithPolicy } from '../git-bridge.js';
import { CONFIG_ALLOWED_PATTERNS } from '../git-policy.js';

function runCustomValidation(customValidation, args) {
  if (!customValidation) return null;
  const result = customValidation(args);
  return result.ok ? null : result;
}

async function checkFileExists(io, path) {
  if (await io.exists(path)) {
    return {
      ok: false,
      errors: [`${path} already exists; this tool only creates new files — to update, edit by hand on this config/* branch`],
    };
  }
  return null;
}

function normaliseKind(kind) {
  return typeof kind === 'string' ? { human: kind, underscored: kind } : kind;
}

export function makeCreator({ kind, pathFor, validator, customValidation }) {
  return async function create(args) {
    const customResult = runCustomValidation(customValidation, args);
    if (customResult) return customResult;

    const v = await validator({ name: args.name, body: args.body, io: args.io });
    if (!v.ok) return { ok: false, errors: v.errors };

    const path = pathFor(args);
    const existsError = await checkFileExists(args.io, path);
    if (existsError) return existsError;

    await args.io.mkdirp(dirname(path));
    await args.io.writeFile(path, args.body);

    const kindNormalised = normaliseKind(kind);

    let sha;
    try {
      sha = commitWithPolicy({
        message: `config: add ${kindNormalised.human} ${args.name}\n\nvia foundry_config_create_${kindNormalised.underscored}`,
        allowedPatterns: CONFIG_ALLOWED_PATTERNS,
        execFile: args.execFile,
      });
    } catch (err) {
      await args.io.rm(path);
      throw err;
    }

    return { ok: true, path, sha };
  };
}
