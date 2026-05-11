import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

describe('Build script import path rewriting', () => {
  test('built plugin has correct import paths and is importable', async () => {
    // Build the package
    execSync('pnpm run build', {
      cwd: projectRoot,
      stdio: 'pipe',
    });

    const builtPlugin = path.join(projectRoot, 'dist', '.opencode', 'plugins', 'foundry.js');
    const builtPluginContent = readFileSync(builtPlugin, 'utf-8');

    // Check that imports to tools are rewritten from ./tools/ to ./foundry-tools/
    assert.ok(
      builtPluginContent.includes("from './foundry-tools/helpers.js'"),
      'Expected import from "./foundry-tools/helpers.js" in built plugin'
    );
    assert.ok(
      !builtPluginContent.includes("from './tools/helpers.js'"),
      'Should not have original "./tools/" import in built plugin'
    );

    // Check that imports to scripts have correct depth
    // From dist/.opencode/plugins (depth=2), we need ../../../scripts/
    const builtHelpers = path.join(projectRoot, 'dist', '.opencode', 'plugins', 'foundry-tools', 'helpers.js');
    const builtHelpersContent = readFileSync(builtHelpers, 'utf-8');
    
    assert.ok(
      builtHelpersContent.includes("from '../../../scripts/"),
      'Expected "../../../scripts/" imports in built helpers.js (3 levels up from foundry-tools/)'
    );
    assert.ok(
      !builtHelpersContent.includes("from '../../../../scripts/"),
      'Should not have 4 levels up for scripts imports'
    );

    // Verify the Foundry guide agent template is packaged
    const builtGuideAgent = path.join(projectRoot, 'dist', 'agents', 'foundry.md');
    const builtGuideAgentContent = readFileSync(builtGuideAgent, 'utf-8');
    assert.ok(
      builtGuideAgentContent.includes('You are the Foundry agent.'),
      'Expected built Foundry guide agent template'
    );

    // Most importantly: verify the built plugin is actually importable
    // Create a temporary directory to simulate npm package installation
    const testDir = mkdtempSync(path.join(tmpdir(), 'foundry-import-test-'));
    try {
      // Try to import the built plugin
      const pluginPath = path.join(projectRoot, 'dist', '.opencode', 'plugins', 'foundry.js');
      
      // This will throw if imports are broken
      const { FoundryPlugin } = await import(pluginPath);
      
      assert.ok(FoundryPlugin, 'FoundryPlugin should be importable from built package');
      assert.equal(typeof FoundryPlugin, 'function', 'FoundryPlugin should be a function');
      
      // Try to instantiate it
      const plugin = await FoundryPlugin({ directory: testDir });
      assert.ok(plugin, 'Plugin should instantiate');
      assert.ok(plugin.tool, 'Plugin should have tool property');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
