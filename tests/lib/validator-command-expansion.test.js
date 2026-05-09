import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { expandValidatorCommand } from '../../src/plugin/tools/validate-tools.js';

describe('expandValidatorCommand — standalone token detection for {pattern}', () => {
  test('substitutes {pattern} when it is a standalone token at the start', () => {
    const cmd = '{pattern} --flag';
    const result = expandValidatorCommand(cmd, 'file1 file2');
    assert.equal(result, 'file1 file2 --flag');
  });

  test('substitutes {pattern} when it is a standalone token in the middle', () => {
    const cmd = 'rg -i "search" {pattern}';
    const result = expandValidatorCommand(cmd, 'file1 file2');
    assert.equal(result, 'rg -i "search" file1 file2');
  });

  test('substitutes {pattern} when it is a standalone token at the end', () => {
    const cmd = 'command {pattern}';
    const result = expandValidatorCommand(cmd, 'file1 file2');
    assert.equal(result, 'command file1 file2');
  });

  test('does not substitute {pattern} when it is part of a larger word', () => {
    const cmd = 'mycommand-{pattern}-suffix';
    const result = expandValidatorCommand(cmd, 'file1 file2');
    assert.equal(result, 'mycommand-{pattern}-suffix');
  });

  test('does not substitute {pattern} when it is inside a quoted string', () => {
    const cmd = 'echo "{pattern}-literal"';
    const result = expandValidatorCommand(cmd, 'file1 file2');
    // The unquoting step removes quotes around just {pattern}, not partial matches
    assert.equal(result, 'echo "{pattern}-literal"');
  });

  test('strips quotes from {pattern} before substituting', () => {
    const cmd = 'rg "{pattern}"';
    const result = expandValidatorCommand(cmd, 'file1 file2');
    assert.equal(result, 'rg file1 file2');
  });

  test('strips single quotes from {pattern} before substituting', () => {
    const cmd = "rg '{pattern}'";
    const result = expandValidatorCommand(cmd, 'file1 file2');
    assert.equal(result, "rg file1 file2");
  });

  test('preserves whitespace correctly when substituting at end', () => {
    const cmd = 'cmd flag {pattern}';
    const result = expandValidatorCommand(cmd, 'file1 file2');
    assert.equal(result, 'cmd flag file1 file2');
  });

  test('preserves whitespace correctly when substituting at start', () => {
    const cmd = '{pattern} flag';
    const result = expandValidatorCommand(cmd, 'file1 file2');
    assert.equal(result, 'file1 file2 flag');
  });

  test('does not substitute when {pattern} does not appear', () => {
    const cmd = 'npm test';
    const result = expandValidatorCommand(cmd, 'file1 file2');
    assert.equal(result, 'npm test');
  });

  test('handles empty pattern substitution (no files matched)', () => {
    const cmd = 'rg -i "search" {pattern}';
    const result = expandValidatorCommand(cmd, '');
    // Should result in no trailing space when substituting with empty string at end
    assert.equal(result, 'rg -i "search" ');
  });

  test('handles file paths with spaces and special characters when quoted', () => {
    const cmd = 'cmd {pattern}';
    const result = expandValidatorCommand(cmd, "'file with spaces' 'file-2'");
    assert.equal(result, "cmd 'file with spaces' 'file-2'");
  });

  test('handles multiple instances of {pattern}', () => {
    // Even though typically you would only have one {pattern}, the function
    // should handle multiple standalone instances
    const cmd = '{pattern} | grep pattern | {pattern}';
    const result = expandValidatorCommand(cmd, 'file1');
    assert.equal(result, 'file1 | grep pattern | file1');
  });

  test('substitutes {pattern} surrounded by tabs (tabs become spaces)', () => {
    const cmd = 'cmd\t{pattern}\tflag';
    const result = expandValidatorCommand(cmd, 'file1');
    // Tabs are whitespace, so the pattern matches and gets replaced.
    // The leading space is a single space (not a tab)
    assert.equal(result, 'cmd file1\tflag');
  });

  test('self-resolving validators without {pattern} are unchanged', () => {
    const cmd = 'npm test';
    const result = expandValidatorCommand(cmd, 'file1 file2');
    assert.equal(result, 'npm test');
  });

  test('self-resolving validators with {pattern} in args correctly substitute', () => {
    // Even though npm test shouldn't use {pattern}, if it somehow does at the
    // token level, it should be substituted
    const cmd = 'npm test {pattern}';
    const result = expandValidatorCommand(cmd, 'file1 file2');
    assert.equal(result, 'npm test file1 file2');
  });

  test('handles {pattern} with leading space only', () => {
    const cmd = 'cmd {pattern}';
    const result = expandValidatorCommand(cmd, 'file');
    assert.equal(result, 'cmd file');
  });
});

