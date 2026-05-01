import { dirname } from 'node:path';
import { commitWithPolicy } from '../git-bridge.js';

export function makeCreator({ kind, pathFor, validator, customValidation }) {
  return async function create(args) {
    // Run custom validation if provided
    if (customValidation) {
      const customResult = customValidation(args);
      if (!customResult.ok) return customResult;
    }

    // Run standard validation
    const v = await validator({ name: args.name, body: args.body, io: args.io });
    if (!v.ok) return { ok: false, errors: v.errors };

    // Determine path (pathFor receives full args and extracts what it needs)
    const path = pathFor(args);
    
    // Check if file exists
    if (await args.io.exists(path)) {
      return {
        ok: false,
        errors: [`${path} already exists; updates are not supported in 3.0.0 — edit by hand on this config/* branch`],
      };
    }

    // Write file
    await args.io.mkdirp(dirname(path));
    await args.io.writeFile(path, args.body);

    // Commit
    const sha = commitWithPolicy({
      message: `config: add ${kind.human} ${args.name}\n\nvia foundry_config_create_${kind.underscored}`,
      allowedPatterns: ['foundry/**'],
      execFile: args.execFile,
    });

    return { ok: true, path, sha };
  };
}
