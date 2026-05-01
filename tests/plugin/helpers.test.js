import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeIO, getBootstrapContent } from '../../.opencode/plugins/foundry-tools/helpers.js';

describe('makeIO.rename', () => {
  test('moves a file atomically within the worktree', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-rename-'));
    try {
      const io = makeIO(dir);
      writeFileSync(path.join(dir, 'src.txt'), 'hello', 'utf-8');
      io.rename('src.txt', 'dst.txt');
      assert.equal(existsSync(path.join(dir, 'src.txt')), false);
      assert.equal(readFileSync(path.join(dir, 'dst.txt'), 'utf-8'), 'hello');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws when source does not exist', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-rename-'));
    try {
      const io = makeIO(dir);
      assert.throws(() => io.rename('missing.txt', 'dst.txt'), { code: 'ENOENT' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('resolves both paths relative to the worktree', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-rename-'));
    try {
      const io = makeIO(dir);
      writeFileSync(path.join(dir, 'a.txt'), 'x', 'utf-8');
      io.rename('a.txt', 'b.txt');
      assert.equal(readFileSync(path.join(dir, 'b.txt'), 'utf-8'), 'x');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('getBootstrapContent', () => {
  test('includes all five pipeline stages in description', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-bootstrap-'));
    try {
      // Create minimal foundry/ directory
      mkdirSync(path.join(dir, 'foundry'));
      
      const content = getBootstrapContent(dir, '/fake/package/root');
      
      // Check for all 5 stages in the pipeline description
      assert.match(content, /assay/, 'Pipeline should mention assay');
      assert.match(content, /forge/, 'Pipeline should mention forge');
      assert.match(content, /quench/, 'Pipeline should mention quench');
      assert.match(content, /appraise/, 'Pipeline should mention appraise');
      assert.match(content, /human-appraise/, 'Pipeline should mention human-appraise');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lists all pipeline skills including assay and human-appraise', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-bootstrap-'));
    try {
      mkdirSync(path.join(dir, 'foundry'));
      
      const content = getBootstrapContent(dir, '/fake/package/root');
      
      // Extract the Pipeline skills line
      const pipelineMatch = content.match(/\*\*Pipeline:\*\*\s+([^\n]+)/);
      assert.ok(pipelineMatch, 'Should have Pipeline skills section');
      
      const pipelineSkills = pipelineMatch[1];
      assert.match(pipelineSkills, /\bassay\b/, 'Pipeline should list assay');
      assert.match(pipelineSkills, /\bforge\b/, 'Pipeline should list forge');
      assert.match(pipelineSkills, /\bquench\b/, 'Pipeline should list quench');
      assert.match(pipelineSkills, /\bappraise\b/, 'Pipeline should list appraise');
      assert.match(pipelineSkills, /\bhuman-appraise\b/, 'Pipeline should list human-appraise');
      assert.match(pipelineSkills, /\borchestrate\b/, 'Pipeline should list orchestrate');
      assert.match(pipelineSkills, /\bflow\b/, 'Pipeline should list flow');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lists all memory-related authoring skills', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-bootstrap-'));
    try {
      mkdirSync(path.join(dir, 'foundry'));
      
      const content = getBootstrapContent(dir, '/fake/package/root');
      
      // Extract the Authoring skills line
      const authoringMatch = content.match(/\*\*Authoring:\*\*\s+([^\n]+)/);
      assert.ok(authoringMatch, 'Should have Authoring skills section');
      
      const authoringSkills = authoringMatch[1];
      assert.match(authoringSkills, /\badd-memory-entity-type\b/, 'Authoring should list add-memory-entity-type');
      assert.match(authoringSkills, /\badd-memory-edge-type\b/, 'Authoring should list add-memory-edge-type');
      assert.match(authoringSkills, /\badd-extractor\b/, 'Authoring should list add-extractor');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lists all memory-related maintenance skills', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-bootstrap-'));
    try {
      mkdirSync(path.join(dir, 'foundry'));
      
      const content = getBootstrapContent(dir, '/fake/package/root');
      
      // Extract the Maintenance skills line
      const maintenanceMatch = content.match(/\*\*Maintenance:\*\*\s+([^\n]+)/);
      assert.ok(maintenanceMatch, 'Should have Maintenance skills section');
      
      const maintenanceSkills = maintenanceMatch[1];
      assert.match(maintenanceSkills, /\binit-memory\b/, 'Maintenance should list init-memory');
      assert.match(maintenanceSkills, /\bchange-embedding-model\b/, 'Maintenance should list change-embedding-model');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
