# Source Directory Structure

This directory contains the source code for the Foundry OpenCode plugin.

## Structure

```
src/
├── plugin/
│   ├── foundry.js         # Main plugin entry point
│   └── tools/             # Tool implementations
│       ├── helpers.js
│       ├── *-tools.js
│       └── ...
├── skills/                # Skill definitions (SKILL.md files)
│   ├── flow/
│   ├── forge/
│   └── ...
└── scripts/               # Helper scripts and libraries
    ├── orchestrate.js
    ├── sort.js
    └── lib/
```

## Build Process

The build script (`scripts/build.js`) transforms this sane development structure into the OpenCode plugin convention:

**Source** → **Published**
- `src/plugin/foundry.js` → `dist/.opencode/plugins/foundry.js`
- `src/plugin/tools/*.js` → `dist/.opencode/plugins/foundry-tools/*.js`
- `src/skills/` → `dist/skills/`
- `src/scripts/` → `dist/scripts/`

The build script also rewrites import paths to account for the new directory depth.

## Development

When working on the plugin:

1. Edit files in `src/`
2. Run `npm run build` to generate `dist/`
3. Test using the built output in `dist/`
4. The `prepublishOnly` script ensures `dist/` is up-to-date before publishing

## Why This Structure?

OpenCode plugins conventionally use `.opencode/plugins/` for plugin code. This makes sense for end users but is awkward for development:

- Hidden directories are harder to navigate
- The structure obscures the logical organization
- Skills and scripts are core functionality, not "config"

By keeping source in a visible `src/` directory and using a build step, we get:
- A sane development experience
- Proper separation of source and distribution
- The correct published structure for OpenCode
