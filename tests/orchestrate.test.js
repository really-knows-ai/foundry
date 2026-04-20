import { test } from 'node:test';
import assert from 'node:assert';
import { renderDispatchPrompt, synthesizeStages } from '../scripts/orchestrate.js';

test('renderDispatchPrompt includes stage, cycle, token, cwd, file-patterns', () => {
  const prompt = renderDispatchPrompt({
    stage: 'forge:create-haiku',
    cycle: 'create-haiku',
    token: 'TOKEN_XYZ',
    cwd: '/tmp/work',
    filePatterns: ['haikus/*.md']
  });
  assert.match(prompt, /Stage: forge:create-haiku/);
  assert.match(prompt, /Cycle: create-haiku/);
  assert.match(prompt, /Token: TOKEN_XYZ/);
  assert.match(prompt, /Working directory: \/tmp\/work/);
  assert.match(prompt, /File patterns \(forge only\): \["haikus\/\*\.md"\]/);
  assert.match(prompt, /foundry_stage_begin\({stage, cycle, token}\)/);
  assert.match(prompt, /foundry_stage_end\({summary}\)/);
  assert.match(prompt, /Do NOT call foundry_history_append/);
});

test('renderDispatchPrompt omits file-patterns line for non-forge stages', () => {
  const prompt = renderDispatchPrompt({
    stage: 'quench:create-haiku',
    cycle: 'create-haiku',
    token: 'T',
    cwd: '/w',
    filePatterns: null
  });
  assert.doesNotMatch(prompt, /File patterns/);
});

test('synthesizeStages: forge + quench + appraise when validation exists', () => {
  const stages = synthesizeStages({
    cycleId: 'c1',
    hasValidation: true,
    humanAppraise: false
  });
  assert.deepStrictEqual(stages, ['forge:c1', 'quench:c1', 'appraise:c1']);
});

test('synthesizeStages: forge + appraise when no validation', () => {
  const stages = synthesizeStages({
    cycleId: 'c1',
    hasValidation: false,
    humanAppraise: false
  });
  assert.deepStrictEqual(stages, ['forge:c1', 'appraise:c1']);
});

test('synthesizeStages: appends human-appraise when flag true', () => {
  const stages = synthesizeStages({
    cycleId: 'c1',
    hasValidation: true,
    humanAppraise: true
  });
  assert.deepStrictEqual(stages, [
    'forge:c1', 'quench:c1', 'appraise:c1', 'human-appraise:c1'
  ]);
});
