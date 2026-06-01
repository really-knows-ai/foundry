import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

/**
 * Build a mock SDK client that returns given providers and connected list.
 */
function mockClient({ providers, connected }) {
  return {
    config: {
      providers: async () => providers,
    },
    provider: {
      list: async () => ({ connected }),
    },
  };
}

test('foundry_list_models returns models from connected providers', async () => {
  const client = mockClient({
    providers: [
      { name: 'opencode-go', models: { 'deepseek-v4-flash': {}, 'deepseek-v4-lite': {} } },
      { name: 'openai', models: { 'gpt-4': {} } },
    ],
    connected: [{ name: 'opencode-go' }],
  });

  const plugin = await FoundryPlugin({ directory: process.cwd(), client });
  const result = JSON.parse(await plugin.tool.foundry_list_models.execute({}, { worktree: process.cwd() }));

  assert.ok(Array.isArray(result.models));
  assert.equal(result.models.length, 2);
  assert.deepStrictEqual(result.models[0], {
    id: 'opencode-go/deepseek-v4-flash',
    provider: 'opencode-go',
    model: 'deepseek-v4-flash',
  });
  assert.deepStrictEqual(result.models[1], {
    id: 'opencode-go/deepseek-v4-lite',
    provider: 'opencode-go',
    model: 'deepseek-v4-lite',
  });
});

test('foundry_list_models returns empty array when no connected providers', async () => {
  const client = mockClient({
    providers: [],
    connected: [],
  });

  const plugin = await FoundryPlugin({ directory: process.cwd(), client });
  const result = JSON.parse(await plugin.tool.foundry_list_models.execute({}, { worktree: process.cwd() }));

  assert.ok(Array.isArray(result.models));
  assert.equal(result.models.length, 0);
});

test('foundry_list_models returns error when client is null', async () => {
  const plugin = await FoundryPlugin({ directory: process.cwd(), client: null });
  const result = JSON.parse(await plugin.tool.foundry_list_models.execute({}, { worktree: process.cwd() }));

  assert.ok(result.error);
  assert.ok(result.error.includes('client not available'));
});

test('foundry_list_models handles provider enumeration failure', async () => {
  const client = {
    config: {
      providers: async () => { throw new Error('Connection refused'); },
    },
    provider: {
      list: async () => ({ connected: [] }),
    },
  };

  const plugin = await FoundryPlugin({ directory: process.cwd(), client });
  const result = JSON.parse(await plugin.tool.foundry_list_models.execute({}, { worktree: process.cwd() }));

  assert.ok(result.error);
  assert.ok(result.error.includes('foundry_list_models: failed to enumerate providers'));
  assert.ok(result.error.includes('Connection refused'));
});
