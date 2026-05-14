---
name: publish-release
description: Use when creating and publishing a new release to npm.
---

# Publish Release

Create a tagged release, update the changelog, and publish to npm. The
workflow commits loose changes, runs the quality gate, versions the
package, builds the changelog, tags, pushes, and publishes.

## Workflow

### 1. Check for uncommitted changes

Run `git status --porcelain`. If there are uncommitted changes, ask the
user whether to commit them. If they agree, stage all changes and create
a commit with message `chore: checkpoint before release`.

If there are staged but uncommitted changes, ask whether to commit them
with the same message.

### 2. Run the quality gate

Run `pnpm build:full`. This chains lint with auto-fix, all tests, and
the build. If it fails, report the failure and stop — do not proceed to
the release.

### 3. Determine the version

Ask the user for the new version string. Default to a patch bump of the
current version in `package.json`. Present the current version and
suggest the next patch as the default, but let the user specify any
valid semver string.

### 4. Update package.json

Use `pnpm version <new-version> --no-git-tag-version` to update
`package.json`. This avoids creating a git tag (the skill handles
tagging later).

### 5. Update CHANGELOG.md

Identify the previous release tag. Find the most recent tag matching
`v*` with `git tag --sort=-v:refname | head -1`. If no tag exists, use
`HEAD~1` as the range start.

Generate the changelog entry. Collect commit messages between the
previous tag and HEAD:

```
git log <prev-tag>..HEAD --oneline
```

Build a new `## [<version>] - <date>` section. Categorise commits by
conventional-commit type:

- `feat:` / `feature:` → **Added**
- `fix:` → **Fixed**
- `chore:` / `refactor:` → **Changed**
- `docs:` → **Docs** (prefer **Changed** for docs in a changelog)
- `test:` → **Testing** (prefer **Changed**)

For each category, list the commit messages as bullet points, stripping
the commit hash and conventional-commit prefix. If a commit message is a
merge commit (`Merge branch ...`), skip it.

Insert the new section at the top of `CHANGELOG.md`, immediately after
the `# Changelog` heading. Follow the same section style as the existing
changelog (see `CHANGELOG.md` for examples).

### 6. Commit the version and changelog

Stage `package.json` and `CHANGELOG.md` and commit with message:

```
release: v<version>
```

### 7. Tag the release

Create a lightweight (non-annotated) tag:

```
git tag v<version>
```

### 8. Push the commit and tag

```
git push origin HEAD
git push origin v<version>
```

If push fails (e.g. no upstream branch), ask the user how to proceed.

### 9. Publish to npm

Run `pnpm publish`. This triggers `prepublishOnly` which runs
`build:all` (lint + test:all + build) — the build step in the quality
gate already ran but the double gate is intentional.

If the publish requires an OTP, ask the user for the one-time password
and retry with:

```
pnpm publish --otp=<code>
```

Confirm the package published successfully by checking the exit code and
the printed package name and version.

### 10. Report the result

Report:
- The new version number
- The tag pushed
- The npm publish result
- A link to the GitHub releases page:
  `https://github.com/really-knows-ai/foundry/releases/tag/v<version>`
