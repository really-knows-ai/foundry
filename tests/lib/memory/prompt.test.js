import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderMemoryPrompt } from '../../../scripts/lib/memory/prompt.js';
import { resolvePermissions } from '../../../scripts/lib/memory/permissions.js';

const vocab = {
  entities: {
    class: { body: 'A Java class observed in source.' },
    method: { body: 'A method on a class.' },
    finding: { body: 'An interpretive observation.' },
  },
  edges: {
    calls: { sources: ['class', 'method'], targets: ['class', 'method'], body: 'Call-site relationship.' },
    has: { sources: ['class'], targets: ['method'], body: 'Method membership.' },
  },
};

describe('renderMemoryPrompt', () => {
  it('returns empty string when cycle has no memory block', () => {
    const perms = resolvePermissions({ cycleFrontmatter: {}, vocabulary: vocab });
    assert.equal(renderMemoryPrompt({ permissions: perms }), '');
  });

  it('includes only readable/writable entity types and accessible edges', () => {
    const perms = resolvePermissions({
      cycleFrontmatter: { memory: { read: ['class', 'method'], write: ['finding'] } },
      vocabulary: vocab,
    });
    const out = renderMemoryPrompt({ permissions: perms });
    assert.match(out, /class/);
    assert.match(out, /method/);
    assert.match(out, /finding/);
    assert.match(out, /calls/);
    assert.match(out, /has/);
  });

  it('marks each type as read-only or read+write', () => {
    const perms = resolvePermissions({
      cycleFrontmatter: { memory: { read: ['class'], write: ['finding'] } },
      vocabulary: vocab,
    });
    const out = renderMemoryPrompt({ permissions: perms });
    assert.match(out, /class.*\(read-only\)/);
    assert.match(out, /finding.*\(read\+write\)/);
  });

  it('includes available tools list in the prompt', () => {
    const perms = resolvePermissions({
      cycleFrontmatter: { memory: { read: ['class'] } },
      vocabulary: vocab,
    });
    const out = renderMemoryPrompt({ permissions: perms });
    assert.match(out, /foundry_memory_get/);
    assert.match(out, /foundry_memory_query/);
    assert.doesNotMatch(out, /foundry_memory_put/);
    assert.doesNotMatch(out, /foundry_memory_relate/);
  });
});
