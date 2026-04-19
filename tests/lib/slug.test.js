import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../../scripts/lib/slug.js';

describe('slugify', () => {
  it('lowercases and replaces spaces with dashes', () => {
    assert.equal(
      slugify('Create haiku about ants watching sunset over NYC'),
      'create-haiku-about-ants-watching-sunset-over-nyc'
    );
  });

  it('lowercases uppercase-only input', () => {
    assert.equal(slugify('HELLO'), 'hello');
  });

  it('strips punctuation', () => {
    assert.equal(slugify('hello!@#$world'), 'hello-world');
  });

  it('strips diacritics from unicode', () => {
    assert.equal(slugify('café naïve'), 'cafe-naive');
  });

  it('collapses multiple consecutive dashes', () => {
    assert.equal(slugify('foo---bar'), 'foo-bar');
  });

  it('collapses mixed separators', () => {
    assert.equal(slugify('foo   bar___baz'), 'foo-bar-baz');
  });

  it('trims leading and trailing spaces/dashes', () => {
    assert.equal(slugify('  hello world  '), 'hello-world');
    assert.equal(slugify('---hello---'), 'hello');
  });

  it('handles mixed case + punctuation + unicode together', () => {
    assert.equal(slugify('Héllo, WORLD!'), 'hello-world');
  });

  it('throws on empty string', () => {
    assert.throws(() => slugify(''), /empty/i);
  });

  it('throws when input slugifies to empty', () => {
    assert.throws(() => slugify('!!!'), /empty/i);
    assert.throws(() => slugify('   '), /empty/i);
  });

  it('throws on non-string input', () => {
    assert.throws(() => slugify(null), /string/i);
    assert.throws(() => slugify(undefined), /string/i);
    assert.throws(() => slugify(123), /string/i);
  });

  it('preserves numerics', () => {
    assert.equal(slugify('version 2.1.0'), 'version-2-1-0');
  });

  it('leaves already-slugged input unchanged', () => {
    assert.equal(slugify('already-a-slug'), 'already-a-slug');
  });
});
