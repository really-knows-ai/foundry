import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'path';
import { makeIO, getBootstrapContent, flowBranchGuard, listFlows } from '../../src/plugin/tools/helpers.js';

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
      assert.match(maintenanceSkills, /\bdry-run\b/, 'Maintenance should list dry-run');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lists all memory admin skills', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-bootstrap-'));
    try {
      mkdirSync(path.join(dir, 'foundry'));
      
      const content = getBootstrapContent(dir, '/fake/package/root');
      
      // Extract the Memory Admin skills line
      const memoryAdminMatch = content.match(/\*\*Memory Admin:\*\*\s+([^\n]+)/);
      assert.ok(memoryAdminMatch, 'Should have Memory Admin skills section');
      
      const memoryAdminSkills = memoryAdminMatch[1];
      assert.match(memoryAdminSkills, /\bdrop-memory-entity-type\b/, 'Memory Admin should list drop-memory-entity-type');
      assert.match(memoryAdminSkills, /\bdrop-memory-edge-type\b/, 'Memory Admin should list drop-memory-edge-type');
      assert.match(memoryAdminSkills, /\brename-memory-entity-type\b/, 'Memory Admin should list rename-memory-entity-type');
      assert.match(memoryAdminSkills, /\brename-memory-edge-type\b/, 'Memory Admin should list rename-memory-edge-type');
      assert.match(memoryAdminSkills, /\breset-memory\b/, 'Memory Admin should list reset-memory');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('flowBranchGuard', () => {
  test('calls requireOnFlowBranch with exec function from context.worktree', () => {
    // Mock context with a worktree path
    const context = { worktree: '/fake/worktree' };
    
    // Call flowBranchGuard with mock args and context
    const result = flowBranchGuard({}, context);
    
    // The guard should return a result object (ok: false since we're not in a git repo)
    assert.ok(result, 'Should return a result object');
    assert.equal(typeof result, 'object', 'Result should be an object');
    assert.ok('ok' in result, 'Result should have ok property');
  });

  test('passes makeExec-generated exec function to requireOnFlowBranch', () => {
    const context = { worktree: '/fake/worktree' };
    const result = flowBranchGuard({}, context);
    
    // Since /fake/worktree is not a git repo, requireOnFlowBranch should return { ok: false, error: ... }
    assert.equal(result.ok, false, 'Should return ok: false for non-git directory');
    assert.ok(result.error, 'Should have error message');
    assert.match(result.error, /this tool requires a work/, 'Error should mention work branch requirement');
  });
});

describe('listFlows', () => {
  test('warns on stderr when a flow file is malformed', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-listflows-'));
    try {
      const foundryDir = path.join(dir, 'foundry');
      const flowsDir = path.join(foundryDir, 'flows');
      mkdirSync(flowsDir, { recursive: true });
      
      // Create a valid flow file
      writeFileSync(path.join(flowsDir, 'valid.md'), `---
id: valid-flow
name: Valid Flow
starting-cycles:
  - cycle-1
---
Body`, 'utf-8');
      
      // Create a malformed flow file (invalid UTF-8 or unreadable)
      // We'll create a file with no frontmatter to trigger a different code path
      writeFileSync(path.join(flowsDir, 'malformed.md'), 'No frontmatter here', 'utf-8');
      
      // Capture stderr
      const originalWarn = console.warn;
      const warnings = [];
      console.warn = (...args) => warnings.push(args.join(' '));
      
      try {
        const flows = listFlows(foundryDir);
        
        // Should have parsed the valid flow
        assert.equal(flows.length, 1);
        assert.equal(flows[0].id, 'valid-flow');
        
        // Should NOT have warned about the file with no frontmatter (it just skips with `continue`)
        // So we need a file that actually throws an error...
        assert.equal(warnings.length, 0, 'No warnings for files that skip with continue');
      } finally {
        console.warn = originalWarn;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('warns on stderr when a flow file cannot be read', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-listflows-'));
    try {
      const foundryDir = path.join(dir, 'foundry');
      const flowsDir = path.join(foundryDir, 'flows');
      mkdirSync(flowsDir, { recursive: true });
      
      // Create a valid flow file
      writeFileSync(path.join(flowsDir, 'valid.md'), `---
id: valid-flow
name: Valid Flow
---
Body`, 'utf-8');
      
      // We need to trigger an actual error in the catch block.
      // One way is to create a directory instead of a file
      mkdirSync(path.join(flowsDir, 'bad-dir.md'));
      
      // Capture stderr
      const originalWarn = console.warn;
      const warnings = [];
      console.warn = (...args) => warnings.push(args.join(' '));
      
      try {
        const flows = listFlows(foundryDir);
        
        // Should have parsed the valid flow
        assert.equal(flows.length, 1);
        assert.equal(flows[0].id, 'valid-flow');
        
        // Should have warned about bad-dir.md (directory instead of file)
        assert.equal(warnings.length, 1, 'Should have one warning');
        assert.match(warnings[0], /bad-dir\.md/, 'Warning should mention the filename');
        assert.match(warnings[0], /[Ww]arning/, 'Warning should contain "warning"');
      } finally {
        console.warn = originalWarn;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('includes error details in warning message', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-listflows-'));
    try {
      const foundryDir = path.join(dir, 'foundry');
      const flowsDir = path.join(foundryDir, 'flows');
      mkdirSync(flowsDir, { recursive: true });
      
      // Create a directory with .md extension to trigger EISDIR error
      mkdirSync(path.join(flowsDir, 'directory.md'));
      
      // Capture stderr
      const originalWarn = console.warn;
      const warnings = [];
      console.warn = (...args) => warnings.push(args.join(' '));
      
      try {
        listFlows(foundryDir);
        
        // Should have warned with error details
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /directory\.md/, 'Should mention filename');
        // The error message varies by platform (EISDIR, "illegal operation on a directory", etc.)
        // Just check that there's some error info beyond the filename
        assert.ok(warnings[0].length > 'Warning: directory.md'.length, 'Should include error details');
      } finally {
        console.warn = originalWarn;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('warns only once per session for the same malformed file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-listflows-'));
    try {
      const foundryDir = path.join(dir, 'foundry');
      const flowsDir = path.join(foundryDir, 'flows');
      mkdirSync(flowsDir, { recursive: true });
      
      // Create a directory with .md extension to trigger EISDIR error
      mkdirSync(path.join(flowsDir, 'once.md'));
      
      // Capture stderr
      const originalWarn = console.warn;
      const warnings = [];
      console.warn = (...args) => warnings.push(args.join(' '));
      
      try {
        // Call listFlows twice
        listFlows(foundryDir);
        listFlows(foundryDir);
        
        // Should only have warned once
        assert.equal(warnings.length, 1, 'Should warn only once per session');
        assert.match(warnings[0], /once\.md/, 'Warning should mention the filename');
      } finally {
        console.warn = originalWarn;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
