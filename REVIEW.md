# 3.0.0 Release Review

## Verdict

**Blocking issues resolved.** `3.0.0` can be released after addressing non-blocking documentation issues.

All blocking issues have been resolved:
- ✅ Built npm package is loadable
- ✅ Full test suite is green (1181/1181 passing)

Non-blocking issues remain (documentation drift, stale tool count).

## Blocking Findings

### 1. Built npm package is not loadable ✅ RESOLVED

`package.json` points `main` at `dist/.opencode/plugins/foundry.js`, but the built file contains broken import paths.

- `dist/.opencode/plugins/foundry.js:13` imports `../../../scripts/lib/secret.js`
- `dist/.opencode/plugins/foundry.js:14` imports `../../../scripts/lib/pending.js`
- `dist/.opencode/plugins/foundry.js:15` imports `./tools/helpers.js`

Those paths do not exist in the packaged output.

The packaged files actually live at:

- `dist/scripts/...`
- `dist/.opencode/plugins/foundry-tools/...`

### Evidence

`npm run build` succeeds, but importing the built plugin fails:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/jledrew/foundry/scripts/lib/secret.js' imported from /Users/jledrew/foundry/dist/.opencode/plugins/foundry.js
```

This is a release blocker because npm consumers would install a package whose entrypoint cannot load.

### Resolution

**Fixed in commit 426c458**

Root cause: Two bugs in `scripts/build.js` rewriteImports function:
1. Line 63: `depth + 1` added one too many `../` to script imports
2. Line 67: Regex looked for `./foundry-tools/` but source has `./tools/`

**Changes:**
- `scripts/build.js:63` - Changed `'../'.repeat(depth + 1)` to `'../'.repeat(depth)`
- `scripts/build.js:67` - Changed regex from `/\.\/foundry-tools\//` to `/\.\/tools\//`
- Added comprehensive test in `tests/build-import-rewriting.test.js` that builds package and verifies importability

**Verification:**
```sh
npm run build
node -e "import('./dist/.opencode/plugins/foundry.js').then(() => console.log('ok'))"
# Output: ok
```

Built package is now loadable. Test suite: 1181/1181 passing.

### 2. Full test suite is not green ✅ RESOLVED

`npm test` completed with `1179` pass and `1` fail.

Failing test:

- `tests/lib/assay/spawn-with-timeout.test.js:65`

Failure summary:

```text
✖ applies SIGKILL after 500ms when process ignores SIGTERM (TF2)
AssertionError [ERR_ASSERTION]: should wait for SIGKILL fallback, took 107ms
```

This blocks a clean release gate unless the failure is understood and explicitly accepted.

### Resolution

**Test now passes** (as of commit e54fb14 "test: make signal test work on both macOS and Linux")

The flaky test was fixed to work reliably on both macOS and Linux. Current test suite: **1181/1181 passing, 0 failures**.

## Non-Blocking Issues

### 1. Public API and docs drift around `foundry_stage_retry`

`foundry_stage_retry` is a public registered tool:

- `src/plugin/tools/stage-tools.js:100`
- `tests/plugin/tool-registration.test.js:68`

It is missing from:

- `docs/tools.md` tool index
- `CHANGELOG.md`

### 2. README tool count is stale

`README.md` still says Foundry ships `60 custom tools`:

- `README.md:439`
- `README.md:486`

That count is stale now that `foundry_stage_retry` is part of the public set.

## Verification Run

Commands run during this review:

```sh
npm run build
npm test
npm pack --dry-run
node -e "import('./dist/.opencode/plugins/foundry.js').then(() => console.log('ok')).catch(err => { console.error(err); process.exit(1); })"
```

Observed results:

- `npm run build` passed
- `npm pack --dry-run` produced a tarball with expected files
- built plugin import failed with `ERR_MODULE_NOT_FOUND`
- `npm test` failed with 1 failing test

## Recommendation

Fix the build import rewriting first, then rerun:

```sh
npm run build
npm test
npm pack --dry-run
node -e "import('./dist/.opencode/plugins/foundry.js').then(() => console.log('ok')).catch(err => { console.error(err); process.exit(1); })"
```
