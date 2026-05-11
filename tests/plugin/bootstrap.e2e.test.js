import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getBootstrapContent } from '../../src/plugin/tools/helpers.js';
import { FoundryPlugin } from '../../src/plugin/foundry.js';

describe('getBootstrapContent', () => {
  test('returns "not initialized" message when foundry/ directory missing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-bootstrap-'));
    try {
      const out = getBootstrapContent(dir, '/fake/pkg');
      assert.ok(out.includes('Foundry is installed but not initialised'));
      assert.ok(out.includes('switch to the Foundry agent'));
      assert.ok(!out.includes('Defined flows'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lists flows from frontmatter when foundry/ is active', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-bootstrap-'));
    try {
      const flowsDir = path.join(dir, 'foundry', 'flows');
      mkdirSync(flowsDir, { recursive: true });
      writeFileSync(
        path.join(flowsDir, 'creative.md'),
        '---\nid: creative-flow\nname: Creative Flow\nstarting-cycles:\n  - draft\n  - polish\n---\n',
        'utf-8'
      );
      const out = getBootstrapContent(dir, '/fake/pkg');
      assert.ok(out.includes('Foundry is active'));
      assert.ok(out.includes('creative-flow'));
      assert.ok(out.includes('Creative Flow'));
      assert.ok(out.includes('starting cycles: draft, polish'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('shows fallback when foundry/ is active but no flows defined', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-bootstrap-'));
    try {
      mkdirSync(path.join(dir, 'foundry', 'flows'), { recursive: true });
      const out = getBootstrapContent(dir, '/fake/pkg');
      assert.ok(out.includes('Foundry is active'));
      assert.ok(out.includes('(no flows defined yet — ask the Foundry agent to set one up)'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('silently skips malformed flow files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-bootstrap-'));
    try {
      const flowsDir = path.join(dir, 'foundry', 'flows');
      mkdirSync(flowsDir, { recursive: true });
      writeFileSync(
        path.join(flowsDir, 'good.md'),
        '---\nid: good-flow\nname: Good Flow\nstarting-cycles:\n  - draft\n---\n',
        'utf-8'
      );
      writeFileSync(path.join(flowsDir, 'bad.md'), 'not yaml\n', 'utf-8');
      writeFileSync(path.join(flowsDir, '.gitkeep'), '', 'utf-8');

      let out;
      assert.doesNotThrow(() => { out = getBootstrapContent(dir, '/fake/pkg'); });
      assert.ok(out.includes('good-flow'));
      assert.ok(out.includes('Good Flow'));
      assert.ok(!out.includes('bad'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('chat.messages.transform', () => {
  test('injects bootstrap into first user message', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-transform-'));
    try {
      const plugin = await FoundryPlugin({ directory: dir });
      const transform = plugin['experimental.chat.messages.transform'];
      const output = {
        messages: [
          { info: { role: 'user' }, parts: [{ type: 'text', text: 'hello' }] },
        ],
      };
      await transform(null, output);
      assert.equal(output.messages[0].parts.length, 2);
      assert.ok(output.messages[0].parts[0].text.startsWith('<FOUNDRY_CONTEXT>'));
      assert.equal(output.messages[0].parts[1].text, 'hello');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('skips when first user message already contains FOUNDRY_CONTEXT', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-transform-'));
    try {
      const plugin = await FoundryPlugin({ directory: dir });
      const transform = plugin['experimental.chat.messages.transform'];
      const output = {
        messages: [
          {
            info: { role: 'user' },
            parts: [{ type: 'text', text: '<FOUNDRY_CONTEXT>existing</FOUNDRY_CONTEXT> hello' }],
          },
        ],
      };
      const before = output.messages[0].parts.length;
      await transform(null, output);
      assert.equal(output.messages[0].parts.length, before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('no-op on empty messages array', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-transform-'));
    try {
      const plugin = await FoundryPlugin({ directory: dir });
      const transform = plugin['experimental.chat.messages.transform'];
      const output = { messages: [] };
      await assert.doesNotReject(() => transform(null, output));
      assert.equal(output.messages.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('no-op when there are no user messages', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-transform-'));
    try {
      const plugin = await FoundryPlugin({ directory: dir });
      const transform = plugin['experimental.chat.messages.transform'];
      const output = {
        messages: [
          { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'hi there' }] },
        ],
      };
      await transform(null, output);
      assert.equal(output.messages[0].parts.length, 1);
      assert.equal(output.messages[0].parts[0].text, 'hi there');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
