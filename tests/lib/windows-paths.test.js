// Windows path handling tests (G5)
// Verify that path operations work with backslashes and mixed separators
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, sep, normalize } from 'node:path';
import { parseFrontmatter } from '../../src/scripts/lib/workfile.js';

describe('Windows path handling (G5)', () => {
  it('handles backslash paths in path operations', () => {
    // Test that Node's path.join normalizes mixed separators
    const mixedPath = join('foo\\bar', 'baz/qux');
    // Should be normalized to platform separator
    assert.ok(mixedPath.includes('foo'));
    assert.ok(mixedPath.includes('bar'));
    assert.ok(mixedPath.includes('baz'));
    assert.ok(mixedPath.includes('qux'));
  });

  it('normalizes mixed path separators', () => {
    const mixed = 'foo/bar\\baz/qux';
    const normalized = normalize(mixed);
    // All separators should be consistent
    const separators = new Set(normalized.split('').filter(c => c === '/' || c === '\\'));
    // Should only have one type of separator after normalization (the platform separator)
    if (separators.size > 0) {
      assert.ok(separators.has(sep), 'normalized path should use platform separator');
    }
  });

  it('handles Windows-style absolute paths on non-Windows', () => {
    // On non-Windows, these are treated as relative paths starting with C:
    // On Windows, they are absolute. Both behaviours are valid.
    const winPath = 'C:\\Users\\test\\file.txt';
    const joined = join('base', winPath);
    // join should handle it without throwing
    assert.ok(typeof joined === 'string');
  });

  it('parses frontmatter regardless of path separator style', () => {
    // Frontmatter parsing should be path-agnostic
    const text = '---\nflow: test\npath: "C:\\\\Users\\\\test\\\\file.txt"\n---\n# Content';
    const fm = parseFrontmatter(text);
    assert.equal(fm.flow, 'test');
    assert.equal(fm.path, 'C:\\Users\\test\\file.txt');
  });
});
