import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

test('plugin captures client reference from PluginInput', async () => {
  const mockClient = { test: true, config: {}, provider: {} };
  const plugin = await FoundryPlugin({ directory: process.cwd(), client: mockClient });
  const captured = plugin[Symbol.for('foundry.test.client')];
  assert.equal(captured, mockClient);
});

test('tool can access client via closure — null client returns error', async () => {
  const plugin = await FoundryPlugin({ directory: process.cwd(), client: null });
  const result = JSON.parse(await plugin.tool.foundry_list_models.execute({}, { worktree: process.cwd() }));
  assert.ok(result.error);
  assert.ok(result.error.includes('client not available'));
});

test('tool can access client via closure — valid client returns models', async () => {
  const mockClient = {
    config: {
      providers: async () => ({ providers: [{ name: 'test-p', models: { 'm1': {} } }] }),
    },
    provider: {
      list: async () => ({ connected: ['test-p'] }),
    },
  };
  const plugin = await FoundryPlugin({ directory: process.cwd(), client: mockClient });
  const result = JSON.parse(await plugin.tool.foundry_list_models.execute({}, { worktree: process.cwd() }));
  assert.ok(Array.isArray(result.models));
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].id, 'test-p/m1');
});
