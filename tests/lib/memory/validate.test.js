import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateEntityWrite, validateEdgeWrite, MAX_VALUE_BYTES } from '../../../scripts/lib/memory/validate.js';

const vocab = {
  entities: { class: {}, method: {} },
  edges: { calls: { sources: ['class', 'method'], targets: ['class', 'method'] }, references: { sources: 'any', targets: 'any' } },
};

describe('validateEntityWrite', () => {
  it('accepts declared type with non-empty name and small value', () => {
    validateEntityWrite({ type: 'class', name: 'x', value: 'ok' }, vocab);
  });

  it('rejects undeclared type', () => {
    assert.throws(() => validateEntityWrite({ type: 'ghost', name: 'x', value: 'v' }, vocab), /not declared/);
  });

  it('rejects empty name', () => {
    assert.throws(() => validateEntityWrite({ type: 'class', name: '', value: 'v' }, vocab), /name/);
  });

  it('rejects non-string value', () => {
    assert.throws(() => validateEntityWrite({ type: 'class', name: 'x', value: 123 }, vocab), /value/);
  });

  it('rejects value over 4KB', () => {
    const big = 'x'.repeat(MAX_VALUE_BYTES + 1);
    assert.throws(() => validateEntityWrite({ type: 'class', name: 'x', value: big }, vocab), /4KB|too large/i);
  });

  it('rejects newline, CR, tab, or NUL in name', () => {
    for (const bad of ['a\nb', 'a\rb', 'a\tb', 'a\0b']) {
      assert.throws(
        () => validateEntityWrite({ type: 'class', name: bad, value: 'v' }, vocab),
        /must not contain newline, carriage return, tab, or NUL/,
      );
    }
  });
});

describe('validateEdgeWrite', () => {
  it('accepts declared edge with matching source/target types', () => {
    validateEdgeWrite({ edge_type: 'calls', from_type: 'class', from_name: 'a', to_type: 'method', to_name: 'b' }, vocab);
  });

  it('rejects undeclared edge type', () => {
    assert.throws(() => validateEdgeWrite({ edge_type: 'wat', from_type: 'class', from_name: 'a', to_type: 'method', to_name: 'b' }, vocab), /not declared/);
  });

  it('rejects from_type outside sources list', () => {
    assert.throws(() => validateEdgeWrite({ edge_type: 'calls', from_type: 'table', from_name: 'a', to_type: 'method', to_name: 'b' }, vocab), /source/);
  });

  it('rejects to_type outside targets list', () => {
    assert.throws(() => validateEdgeWrite({ edge_type: 'calls', from_type: 'class', from_name: 'a', to_type: 'table', to_name: 'b' }, vocab), /target/);
  });

  it("allows 'any' source/target on narrative edges", () => {
    validateEdgeWrite({ edge_type: 'references', from_type: 'class', from_name: 'a', to_type: 'table', to_name: 'b' }, vocab);
  });

  it('rejects newline / CR / tab / NUL in from_name or to_name', () => {
    for (const bad of ['a\nb', 'a\rb', 'a\tb', 'a\0b']) {
      assert.throws(
        () => validateEdgeWrite({ edge_type: 'calls', from_type: 'class', from_name: bad, to_type: 'method', to_name: 'x' }, vocab),
        /from_name must not contain/,
      );
      assert.throws(
        () => validateEdgeWrite({ edge_type: 'calls', from_type: 'class', from_name: 'x', to_type: 'method', to_name: bad }, vocab),
        /to_name must not contain/,
      );
    }
  });
});
