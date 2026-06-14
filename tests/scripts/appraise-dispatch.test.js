import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import { dispatchAppraisePrompt } from '../../src/scripts/lib/appraise-dispatch.js';

function makeEntry(appraiser) {
  return {
    group: 'default',
    pass: 1,
    appraiser,
    unit: { id: 'default:bundle', group: 'default', mode: 'bundle', lawIds: ['law-1'] },
  };
}

function makeOpts(extra = {}) {
  return {
    io: {},
    worktree: '/w',
    lawGroups: new Map([['default', [{ id: 'law-1', text: 'Law text' }]]]),
    outputType: 'haiku',
    writePromptFile: mock.fn(() => '/prompt'),
    spawnDispatch: mock.fn(() => ({})),
    awaitProcess: mock.fn(() => Promise.resolve()),
    withCleanup: async (_io, fn) => fn([]),
    ...extra,
  };
}

test('dispatchAppraisePrompt passes stage model to opencode run', async () => {
  const opts = makeOpts({ stageModel: 'opencode-go/qwen3.6-plus' });

  await dispatchAppraisePrompt(makeEntry({ id: 'critic' }), opts);

  assert.equal(opts.spawnDispatch.mock.callCount(), 1);
  assert.deepEqual(opts.spawnDispatch.mock.calls[0].arguments, [
    '/w', '/prompt', 'foundry-appraise', 'opencode-go/qwen3.6-plus',
  ]);
});

test('dispatchAppraisePrompt prefers appraiser model over stage model', async () => {
  const opts = makeOpts({ stageModel: 'opencode-go/qwen3.6-plus' });

  await dispatchAppraisePrompt(makeEntry({ id: 'critic', model: 'openai/gpt-4o' }), opts);

  assert.equal(opts.spawnDispatch.mock.callCount(), 1);
  assert.equal(opts.spawnDispatch.mock.calls[0].arguments[3], 'openai/gpt-4o');
});
