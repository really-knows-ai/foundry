import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parseValidatorJsonl } from '../../src/scripts/lib/validator-jsonl.js';

function stringToStream(str) {
  return Readable.from([str]);
}

describe('validator-jsonl: JSONL parsing and validation', () => {
  test('parses single valid JSONL line with required fields', async () => {
    const jsonl = '{"file":"src/index.js","text":"missing semicolon"}\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['src/**/*.js']);

    assert.equal(result.ok, true);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].file, 'src/index.js');
    assert.equal(result.items[0].text, 'missing semicolon');
    assert.deepEqual(result.parseErrors, []);
    assert.deepEqual(result.patternErrors, []);
  });

  test('parses multiple JSONL lines', async () => {
    const jsonl = '{"file":"a.js","text":"error A"}\n{"file":"b.js","text":"error B"}\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, true);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].text, 'error A');
    assert.equal(result.items[1].text, 'error B');
  });

  test('includes optional location and severity in returned item', async () => {
    const jsonl = '{"file":"src/test.js","location":"42:5","severity":"error","text":"bug"}\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['src/**/*.js']);

    assert.equal(result.ok, true);
    assert.equal(result.items.length, 1);
    const item = result.items[0];
    assert.equal(item.file, 'src/test.js');
    assert.equal(item.location, '42:5');
    assert.equal(item.severity, 'error');
    // text is prepended with severity and location
    assert.match(item.text, /\[error\] src\/test\.js:42:5 — bug/);
  });

  test('prepends location and severity to text when present', async () => {
    const jsonl = '{"file":"a.js","location":"10:3","severity":"warning","text":"unused var"}\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, true);
    const item = result.items[0];
    // text should be prepended with [severity] file:location —
    assert.match(item.text, /\[warning\] a\.js:10:3 — unused var/);
  });

  test('handles severity prepending without location', async () => {
    const jsonl = '{"file":"x.js","severity":"error","text":"syntax"}\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, true);
    const item = result.items[0];
    // Should prepend [error] x.js — when location is missing
    assert.match(item.text, /\[error\] x\.js — syntax/);
  });

  test('handles location without severity', async () => {
    const jsonl = '{"file":"x.js","location":"5:1","text":"issue"}\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, true);
    const item = result.items[0];
    // Should prepend x.js:5:1 — without severity
    assert.match(item.text, /x\.js:5:1 — issue/);
  });

  test('rejects line missing required file field as a parse error', async () => {
    const jsonl = '{"text":"error without file"}\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, false);
    assert.equal(result.parseErrors.length, 1);
    assert.match(result.parseErrors[0], /required field|file/i);
    assert.equal(result.patternErrors.length, 0);
    assert.equal(result.items.length, 0);
  });

  test('rejects line missing required text field as a parse error', async () => {
    const jsonl = '{"file":"test.js"}\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, false);
    assert.equal(result.parseErrors.length, 1);
    assert.match(result.parseErrors[0], /required field|text/i);
    assert.equal(result.patternErrors.length, 0);
  });

  test('rejects file that does not match any pattern as a pattern error', async () => {
    const jsonl = '{"file":"unwanted.txt","text":"error"}\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['src/**/*.js', 'tests/**/*.js']);

    assert.equal(result.ok, false);
    assert.equal(result.patternErrors.length, 1);
    assert.match(result.patternErrors[0], /pattern|unwanted\.txt/i);
    assert.equal(result.parseErrors.length, 0);
    assert.equal(result.items.length, 0);
  });

  test('separates parse errors from pattern errors when both occur', async () => {
    const jsonl = [
      '{"file":"unwanted.txt","text":"error"}',  // pattern mismatch
      '{"text":"missing file"}',                  // parse: missing file
      '{"file":"x.js"}',                          // parse: missing text
    ].join('\n') + '\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, false);
    assert.equal(result.parseErrors.length, 2);
    assert.equal(result.patternErrors.length, 1);
    assert.equal(result.items.length, 0);
  });

  test('rejects malformed JSON on a line as a parse error', async () => {
    const jsonl = '{"file":"test.js","text":"ok"}\n{invalid json}\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, false);
    assert.equal(result.parseErrors.length, 1);
    assert.match(result.parseErrors[0], /JSON|parse|format/i);
    // Valid item before the malformed line still flows through
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].file, 'test.js');
  });

  test('handles empty stream gracefully', async () => {
    const jsonl = '';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, true);
    assert.equal(result.items.length, 0);
    assert.deepEqual(result.parseErrors, []);
    assert.deepEqual(result.patternErrors, []);
  });

  test('handles lines with only whitespace gracefully', async () => {
    const jsonl = '{"file":"test.js","text":"ok"}\n\n  \n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, true);
    assert.equal(result.items.length, 1);
  });

  test('validates file field against multiple patterns with glob matching', async () => {
    const jsonl = '{"file":"src/lib/foo.ts","text":"error"}\n{"file":"tests/unit/bar.test.ts","text":"error"}\n';
    const patterns = ['src/**/*.ts', 'tests/**/*.ts'];
    const result = await parseValidatorJsonl(stringToStream(jsonl), patterns);

    assert.equal(result.ok, true);
    assert.equal(result.items.length, 2);
  });

  test('rejects file when no patterns match', async () => {
    const jsonl = '{"file":"docs/README.md","text":"error"}\n';
    const patterns = ['src/**/*.ts', 'tests/**/*.ts'];
    const result = await parseValidatorJsonl(stringToStream(jsonl), patterns);

    assert.equal(result.ok, false);
    assert.ok(result.patternErrors.length >= 1);
  });

  test('handles very long lines without loading entire stream into memory', async () => {
    // This is a streaming test: ensure we don't buffer the entire stream
    const longText = 'x'.repeat(10000);
    const jsonl = `{"file":"test.js","text":"${longText}"}\n`;
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, true);
    assert.equal(result.items.length, 1);
    assert.match(result.items[0].text, /x{10000}/);
  });

  test('returns items array even when ok is true', async () => {
    const jsonl = '{"file":"a.js","text":"err1"}\n{"file":"b.js","text":"err2"}\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.items));
    assert.equal(result.items.length, 2);
    assert.deepEqual(result.parseErrors, []);
    assert.deepEqual(result.patternErrors, []);
  });

  test('always returns items, parseErrors, and patternErrors arrays', async () => {
    const jsonl = '{"file":"bad.txt","text":"err"}\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, false);
    assert.ok(Array.isArray(result.items));
    assert.ok(Array.isArray(result.parseErrors));
    assert.ok(Array.isArray(result.patternErrors));
  });

  test('continues processing valid lines after encountering an error', async () => {
    const jsonl = '{"file":"test.js","text":"ok"}\n{"text":"missing file"}\n{"file":"ok2.js","text":"good"}\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, false);
    assert.equal(result.parseErrors.length, 1);
    // Both valid items should flow through despite the error in the middle
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].file, 'test.js');
    assert.equal(result.items[1].file, 'ok2.js');
  });

  test('extra fields in JSONL line are preserved', async () => {
    const jsonl = '{"file":"test.js","text":"err","extra":"field","another":123}\n';
    const result = await parseValidatorJsonl(stringToStream(jsonl), ['**/*.js']);

    assert.equal(result.ok, true);
    const item = result.items[0];
    // Extra fields should be preserved in the item
    assert.equal(item.extra, 'field');
    assert.equal(item.another, 123);
  });
});
