import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, renderMarkdown } from '../../../src/scripts/lib/memory/frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses LF-delimited frontmatter', () => {
    const text = `---\ntype: class\n---\n\nBody here.\n`;
    const out = parseFrontmatter(text);
    assert.equal(out.hasFrontmatter, true);
    assert.deepEqual(out.frontmatter, { type: 'class' });
    assert.equal(out.body, '\nBody here.\n');
  });

  it('parses CRLF-delimited frontmatter', () => {
    const text = `---\r\ntype: class\r\n---\r\n\r\nBody here.\r\n`;
    const out = parseFrontmatter(text);
    assert.equal(out.hasFrontmatter, true);
    assert.deepEqual(out.frontmatter, { type: 'class' });
    assert.match(out.body, /Body here\./);
  });

  it('returns hasFrontmatter:false for plain text', () => {
    const out = parseFrontmatter('just markdown, no frontmatter\n');
    assert.equal(out.hasFrontmatter, false);
    assert.deepEqual(out.frontmatter, {});
    assert.equal(out.body, 'just markdown, no frontmatter\n');
  });

  it('returns empty frontmatter object on non-object YAML (e.g. scalar)', () => {
    const out = parseFrontmatter(`---\njust a string\n---\n`);
    assert.deepEqual(out.frontmatter, {});
    assert.equal(out.hasFrontmatter, true);
  });

  it('handles malformed YAML gracefully (returns empty frontmatter)', () => {
    const bad = `---\nkey: [unclosed\n---\n`;
    const out = parseFrontmatter(bad, { filename: 'foundry/memory/entities/class.md' });
    assert.deepEqual(out.frontmatter, {});
    assert.equal(out.hasFrontmatter, false);
  });

  it('handles YAML errors gracefully without a filename', () => {
    const bad = `---\nkey: [unclosed\n---\n`;
    const out = parseFrontmatter(bad);
    assert.deepEqual(out.frontmatter, {});
    assert.equal(out.hasFrontmatter, false);
  });
});

describe('renderMarkdown', () => {
  it('round-trips through parseFrontmatter', () => {
    const doc = renderMarkdown({ type: 'class', n: 2 }, '\n# Heading\n\nBody.\n');
    const parsed = parseFrontmatter(doc);
    assert.deepEqual(parsed.frontmatter, { type: 'class', n: 2 });
    assert.match(parsed.body, /# Heading/);
    assert.match(parsed.body, /Body\./);
  });

  it('renders with empty body', () => {
    const doc = renderMarkdown({ a: 1 });
    assert.match(doc, /^---\na: 1\n---\n/);
    assert.deepEqual(parseFrontmatter(doc).frontmatter, { a: 1 });
  });
});
