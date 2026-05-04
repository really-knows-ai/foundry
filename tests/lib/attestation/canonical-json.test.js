import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../../../src/scripts/lib/attestation/canonical-json.js';
import { sha256Text, sortPaths } from '../../../src/scripts/lib/attestation/hash.js';

test('canonicalJson sorts object keys recursively and preserves array order', () => {
  const payload = {
    z: 1,
    a: { y: 2, x: 3 },
    list: [{ b: 2, a: 1 }, 'keep-order'],
  };

  assert.equal(
    canonicalJson(payload),
    '{"a":{"x":3,"y":2},"list":[{"a":1,"b":2},"keep-order"],"z":1}'
  );
});

test('sha256Text hashes the canonical string deterministically', () => {
  assert.equal(
    sha256Text('{"a":1}'),
    '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862'
  );
});

test('canonicalJson preserves Date serialisation', () => {
  const payload = { d: new Date('2020-01-01T00:00:00.000Z') };
  assert.equal(
    canonicalJson(payload),
    '{"d":"2020-01-01T00:00:00.000Z"}'
  );
});

test('canonicalJson uses lexical key ordering', () => {
  const payload = { '10': 'a', '2': 'b' };
  assert.equal(
    canonicalJson(payload),
    '{"10":"a","2":"b"}'
  );
});

test('canonicalJson converts undefined array elements to null', () => {
  assert.equal(
    canonicalJson([undefined]),
    '[null]'
  );
});

test('canonicalJson converts sparse array holes to null', () => {
  assert.equal(
    canonicalJson([, 1]),
    '[null,1]'
  );
});

test('canonicalJson unwraps boxed Number primitive', () => {
  assert.equal(
    canonicalJson(new Number(1)),
    '1'
  );
});

test('canonicalJson unwraps boxed String primitive', () => {
  assert.equal(
    canonicalJson(new String('x')),
    '"x"'
  );
});

test('canonicalJson unwraps boxed Boolean primitive', () => {
  assert.equal(
    canonicalJson(new Boolean(false)),
    'false'
  );
});

test('canonicalJson throws on BigInt', () => {
  assert.throws(
    () => canonicalJson({ ok: 1, bad: 2n }),
    {
      name: 'TypeError',
      message: /BigInt/
    }
  );
});

test('canonicalJson throws on boxed BigInt', () => {
  assert.throws(
    () => canonicalJson(Object(2n)),
    {
      name: 'TypeError',
      message: /BigInt/
    }
  );
});

test('canonicalJson throws on nested boxed BigInt', () => {
  assert.throws(
    () => canonicalJson({ x: Object(2n) }),
    {
      name: 'TypeError',
      message: /BigInt/
    }
  );
});

test('canonicalJson throws on self-referential object', () => {
  const obj = { a: 1 };
  obj.self = obj;
  
  assert.throws(
    () => canonicalJson(obj),
    {
      name: 'TypeError',
      message: /circular|cyclic/i
    }
  );
});

test('canonicalJson throws on self-referential array', () => {
  const arr = [1];
  arr.push(arr);
  
  assert.throws(
    () => canonicalJson(arr),
    {
      name: 'TypeError',
      message: /circular|cyclic/i
    }
  );
});

test('sortPaths uses stable lexical byte ordering', () => {
  // Test that sortPaths uses simple lexical ordering (codepoint comparison)
  // rather than locale-aware collation which can vary across ICU builds
  const paths = [
    'src/zulu.js',
    'src/Alpha.js',
    'src/beta.js',
    'src/10-file.js',
    'src/2-file.js',
    'src/ñoño.js',
    'src/alpha.js',
  ];

  const sorted = sortPaths(paths);

  // Lexical byte ordering (codepoint comparison):
  // - Digits come before uppercase letters
  // - Uppercase letters come before lowercase letters
  // - Extended ASCII/UTF-8 characters sort after basic ASCII
  assert.deepEqual(sorted, [
    'src/10-file.js',
    'src/2-file.js',
    'src/Alpha.js',
    'src/alpha.js',
    'src/beta.js',
    'src/zulu.js',
    'src/ñoño.js',
  ]);
});

test('sortPaths does not mutate input array', () => {
  const original = ['z.js', 'a.js', 'b.js'];
  const copy = [...original];
  
  sortPaths(original);
  
  assert.deepEqual(original, copy, 'sortPaths should not mutate the input array');
});
