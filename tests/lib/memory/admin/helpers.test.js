import { test } from 'node:test';
import assert from 'node:assert';
import { composeMarkdown, renderEdgeFrontmatter } from '../../../../src/scripts/lib/memory/admin/helpers.js';

test('renderEdgeFrontmatter: renders type and sources/targets', () => {
  const result = renderEdgeFrontmatter({
    type: 'implements',
    sources: ['file'],
    targets: ['interface'],
  });
  assert.strictEqual(result, `type: implements\nsources: [file]\ntargets: [interface]`);
});

test('renderEdgeFrontmatter: handles "any" as special case', () => {
  const result = renderEdgeFrontmatter({
    type: 'relates-to',
    sources: 'any',
    targets: 'any',
  });
  assert.strictEqual(result, `type: relates-to\nsources: any\ntargets: any`);
});

test('renderEdgeFrontmatter: handles multiple sources/targets', () => {
  const result = renderEdgeFrontmatter({
    type: 'links',
    sources: ['file', 'class', 'function'],
    targets: ['doc', 'note'],
  });
  assert.strictEqual(result, `type: links\nsources: [file, class, function]\ntargets: [doc, note]`);
});

test('composeMarkdown: combines frontmatter and body with proper formatting', () => {
  const fm = `type: test\nsources: any\ntargets: any`;
  const body = `This is the body`;
  const result = composeMarkdown(fm, body);
  assert.strictEqual(result, `---\n${fm}\n---\nThis is the body`);
});

test('composeMarkdown: strips leading newline from body if present', () => {
  const fm = `type: test\nsources: any\ntargets: any`;
  const body = `\nThis is the body`;
  const result = composeMarkdown(fm, body);
  assert.strictEqual(result, `---\n${fm}\n---\nThis is the body`);
});

test('composeMarkdown: preserves body with no leading newline', () => {
  const fm = `type: test\nsources: any\ntargets: any`;
  const body = `This starts immediately`;
  const result = composeMarkdown(fm, body);
  assert.strictEqual(result, `---\n${fm}\n---\nThis starts immediately`);
});
