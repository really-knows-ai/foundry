import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expandValidatorCommand } from '../../src/plugin/tools/validate-tools.js';

describe('expandValidatorCommand — placeholder substitution', () => {
  const PATTERN = "'haikus/*.md' 'drafts/*.md'";
  const FILES = "'haikus/one.md' 'haikus/two.md'";

  it('substitutes {files} as a standalone token', () => {
    const out = expandValidatorCommand('node check.mjs {files}', { pattern: PATTERN, files: FILES });
    assert.equal(out, "node check.mjs 'haikus/one.md' 'haikus/two.md'");
  });

  it('substitutes {pattern} as a standalone token', () => {
    const out = expandValidatorCommand("rg --glob {pattern} 'TODO'", { pattern: PATTERN, files: FILES });
    assert.equal(out, "rg --glob 'haikus/*.md' 'drafts/*.md' 'TODO'");
  });

  it('substitutes both {pattern} and {files} when present', () => {
    const out = expandValidatorCommand('lint --globs {pattern} -- {files}', { pattern: PATTERN, files: FILES });
    assert.equal(out, "lint --globs 'haikus/*.md' 'drafts/*.md' -- 'haikus/one.md' 'haikus/two.md'");
  });

  it('passes verbatim commands through unchanged', () => {
    const out = expandValidatorCommand('npm test', { pattern: PATTERN, files: FILES });
    assert.equal(out, 'npm test');
  });

  it('strips surrounding double quotes around {pattern}', () => {
    const out = expandValidatorCommand('rg --glob "{pattern}" TODO', { pattern: PATTERN, files: FILES });
    assert.equal(out, "rg --glob 'haikus/*.md' 'drafts/*.md' TODO");
  });

  it('strips surrounding single quotes around {pattern}', () => {
    const out = expandValidatorCommand("rg --glob '{pattern}' TODO", { pattern: PATTERN, files: FILES });
    assert.equal(out, "rg --glob 'haikus/*.md' 'drafts/*.md' TODO");
  });

  it('strips surrounding double quotes around {files}', () => {
    const out = expandValidatorCommand('cat "{files}"', { pattern: PATTERN, files: FILES });
    assert.equal(out, "cat 'haikus/one.md' 'haikus/two.md'");
  });

  it('strips surrounding single quotes around {files}', () => {
    const out = expandValidatorCommand("cat '{files}'", { pattern: PATTERN, files: FILES });
    assert.equal(out, "cat 'haikus/one.md' 'haikus/two.md'");
  });

  it('does not substitute {files} inside a larger token', () => {
    const out = expandValidatorCommand('echo prefix{files}suffix', { pattern: PATTERN, files: FILES });
    assert.equal(out, 'echo prefix{files}suffix');
  });

  it('does not substitute {pattern} inside a larger token', () => {
    const out = expandValidatorCommand('echo prefix{pattern}suffix', { pattern: PATTERN, files: FILES });
    assert.equal(out, 'echo prefix{pattern}suffix');
  });

  it('replaces multiple {files} occurrences', () => {
    const out = expandValidatorCommand('foo {files} bar {files}', { pattern: PATTERN, files: FILES });
    assert.equal(out, "foo 'haikus/one.md' 'haikus/two.md' bar 'haikus/one.md' 'haikus/two.md'");
  });

  it('preserves a single leading space when {files} starts the command', () => {
    const out = expandValidatorCommand('{files}', { pattern: PATTERN, files: FILES });
    assert.equal(out, FILES);
  });
});

describe('expandValidatorCommand — empty inputs', () => {
  it('substitutes empty string when files list is empty', () => {
    const out = expandValidatorCommand('cat {files}', { pattern: "'*.md'", files: '' });
    assert.equal(out, 'cat ');
  });

  it('substitutes empty pattern string when patterns array is empty', () => {
    const out = expandValidatorCommand('rg --glob {pattern} TODO', { pattern: '', files: "'a.md'" });
    assert.equal(out, 'rg --glob  TODO');
  });
});
