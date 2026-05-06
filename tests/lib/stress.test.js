// Stress tests for large files and data structures (G2)
// Tests for large WORK.md files, huge history YAMLs, thousands of feedback items
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  writeFrontmatter,
  setFrontmatterField,
} from '../../src/scripts/lib/workfile.js';
import yaml from 'js-yaml';

// Extract body from WORK.md text (after frontmatter)
function extractBody(text) {
  const match = text.match(/^---\n.*?\n---\n(.*)$/s);
  return match ? match[1] : text;
}

describe('Stress tests (G2)', () => {
  it('parses large WORK.md frontmatter (1000+ fields)', () => {
    // Generate frontmatter with many fields
    const fields = {};
    for (let i = 0; i < 1000; i++) {
      fields[`field_${i}`] = `value_${i}`;
    }
    const yamlContent = yaml.dump(fields);
    const text = `---\n${yamlContent}---\n# Body`;
    
    const start = Date.now();
    const fm = parseFrontmatter(text);
    const elapsed = Date.now() - start;
    
    assert.equal(Object.keys(fm).length, 1000);
    assert.equal(fm.field_0, 'value_0');
    assert.equal(fm.field_999, 'value_999');
    assert.ok(elapsed < 1000, `parsing should complete in reasonable time, took ${elapsed}ms`);
  });

  it('parses WORK.md with very large body (1MB+)', () => {
    // 1MB of body content
    const bodyLines = [];
    for (let i = 0; i < 20000; i++) {
      bodyLines.push(`Line ${i}: ${'x'.repeat(40)}`);
    }
    const body = bodyLines.join('\n');
    const text = `---\nflow: test\n---\n${body}`;
    
    const start = Date.now();
    const fm = parseFrontmatter(text);
    const extracted = extractBody(text);
    const elapsed = Date.now() - start;
    
    assert.equal(fm.flow, 'test');
    assert.ok(extracted.includes('Line 0:'));
    assert.ok(extracted.includes('Line 19999:'));
    assert.ok(elapsed < 2000, `parsing large body should complete in reasonable time, took ${elapsed}ms`);
  });

  it('handles history YAML with thousands of entries', () => {
    // Simulate a history with 5000 entries
    const history = [];
    for (let i = 0; i < 5000; i++) {
      history.push({
        timestamp: `2024-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`,
        cycle: i % 2 === 0 ? 'forge' : 'appraise',
        stage: 'quench',
        model: 'gpt-4',
        result: i % 10 === 0 ? 'blocked' : 'done',
        feedback: `Feedback item ${i}`,
      });
    }
    
    const start = Date.now();
    const yamlStr = yaml.dump(history);
    const parsed = yaml.load(yamlStr);
    const elapsed = Date.now() - start;
    
    assert.equal(parsed.length, 5000);
    assert.equal(parsed[0].feedback, 'Feedback item 0');
    assert.equal(parsed[4999].feedback, 'Feedback item 4999');
    assert.ok(elapsed < 3000, `serializing and parsing huge history should complete in reasonable time, took ${elapsed}ms`);
  });

  it('handles feedback YAML with thousands of items', () => {
    // Simulate feedback with 3000 items
    const feedback = [];
    for (let i = 0; i < 3000; i++) {
      feedback.push({
        id: i,
        type: i % 3 === 0 ? 'error' : i % 3 === 1 ? 'warning' : 'info',
        message: `This is feedback message number ${i} with some additional context about what went wrong or right.`,
        location: `file_${i % 100}.js:${i % 500}`,
      });
    }
    
    const start = Date.now();
    const yamlStr = yaml.dump(feedback);
    const parsed = yaml.load(yamlStr);
    const elapsed = Date.now() - start;
    
    assert.equal(parsed.length, 3000);
    assert.equal(parsed[0].message, 'This is feedback message number 0 with some additional context about what went wrong or right.');
    assert.equal(parsed[2999].id, 2999);
    assert.ok(elapsed < 3000, `handling thousands of feedback items should complete in reasonable time, took ${elapsed}ms`);
  });

  it('updates frontmatter on large WORK.md without corrupting body', () => {
    // Large body with special characters
    const bodyLines = [];
    for (let i = 0; i < 5000; i++) {
      bodyLines.push(`# Section ${i}\nContent with **markdown** and \`code\` and special chars: \${var} @mention`);
    }
    const body = bodyLines.join('\n\n');
    const original = `---\nflow: test\niteration: 1\n---\n${body}`;
    
    const start = Date.now();
    let updated = setFrontmatterField(original, 'iteration', 2);
    updated = setFrontmatterField(updated, 'status', 'done');
    const elapsed = Date.now() - start;
    
    const fm = parseFrontmatter(updated);
    const newBody = extractBody(updated);
    
    assert.equal(fm.flow, 'test');
    assert.equal(fm.iteration, 2);
    assert.equal(fm.status, 'done');
    assert.equal(newBody, body, 'body should be preserved exactly');
    assert.ok(elapsed < 2000, `updating large frontmatter should complete in reasonable time, took ${elapsed}ms`);
  });

  it('handles deeply nested frontmatter structures', () => {
    // Create a deeply nested structure
    const nested = { level0: {} };
    let current = nested.level0;
    for (let i = 1; i < 50; i++) {
      current[`level${i}`] = {};
      current = current[`level${i}`];
    }
    current.value = 'deep';
    
    const start = Date.now();
    const yamlStr = writeFrontmatter(nested);
    const text = `${yamlStr}\n# Body`;
    const parsed = parseFrontmatter(text);
    const elapsed = Date.now() - start;
    
    // Navigate to the deep value
    let check = parsed.level0;
    for (let i = 1; i < 50; i++) {
      check = check[`level${i}`];
    }
    assert.equal(check.value, 'deep');
    assert.ok(elapsed < 1000, `handling deeply nested structures should complete in reasonable time, took ${elapsed}ms`);
  });

  it('handles frontmatter with very long string values', () => {
    // String value that's 100KB
    const longString = 'x'.repeat(100 * 1024);
    const fm = { goal: longString };
    
    const start = Date.now();
    const yamlStr = writeFrontmatter(fm);
    const text = `${yamlStr}\n# Body`;
    const parsed = parseFrontmatter(text);
    const elapsed = Date.now() - start;
    
    assert.equal(parsed.goal.length, 100 * 1024);
    assert.equal(parsed.goal, longString);
    assert.ok(elapsed < 2000, `handling very long strings should complete in reasonable time, took ${elapsed}ms`);
  });

  it('handles frontmatter with thousands of array items', () => {
    // Array with 10000 items
    const largeArray = [];
    for (let i = 0; i < 10000; i++) {
      largeArray.push(`item_${i}`);
    }
    const fm = { tags: largeArray };
    
    const start = Date.now();
    const yamlStr = writeFrontmatter(fm);
    const text = `${yamlStr}\n# Body`;
    const parsed = parseFrontmatter(text);
    const elapsed = Date.now() - start;
    
    assert.equal(parsed.tags.length, 10000);
    assert.equal(parsed.tags[0], 'item_0');
    assert.equal(parsed.tags[9999], 'item_9999');
    assert.ok(elapsed < 3000, `handling large arrays should complete in reasonable time, took ${elapsed}ms`);
  });
});
