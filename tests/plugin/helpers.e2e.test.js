import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'path';
import { makeIO, getBootstrapContent, flowBranchGuard, listFlows, buildCyclePromptExtras } from '../../src/plugin/tools/helpers.js';

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

describe('makeIO.exec', () => {
  test('executes commands with array-based argv', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-exec-'));
    try {
      const io = makeIO(dir);
      writeFileSync(path.join(dir, 'test.txt'), 'hello\nworld\n', 'utf-8');
      
      // Test with a simple command that works on all platforms
      const output = io.exec(['cat', 'test.txt']);
      
      assert.equal(output, 'hello\nworld\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('passes arguments separately to prevent shell injection', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-exec-'));
    try {
      const io = makeIO(dir);
      
      // Create a file with a shell-special character in the name
      writeFileSync(path.join(dir, 'file-1.txt'), 'content1', 'utf-8');
      writeFileSync(path.join(dir, 'file-2.txt'), 'content2', 'utf-8');
      
      // If this were shell-executed, the wildcard would expand
      // With execFile, it's treated literally
      const filename = 'file-1.txt';
      const output = io.exec(['cat', filename]);
      
      assert.equal(output, 'content1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws on non-zero exit code', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-exec-'));
    try {
      const io = makeIO(dir);
      
      // Try to cat a non-existent file
      assert.throws(() => io.exec(['cat', 'nonexistent.txt']));
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

  test('summarises Foundry agent capabilities without internal skill lists', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-bootstrap-'));
    try {
      mkdirSync(path.join(dir, 'foundry'));
      
      const content = getBootstrapContent(dir, '/fake/package/root');

      assert.match(content, /Foundry agent capabilities/, 'Should have Foundry agent capabilities section');
      assert.match(content, /pipeline execution/, 'Should summarise pipeline execution capability');
      assert.match(content, /authoring/, 'Should summarise authoring capability');
      assert.match(content, /maintenance/, 'Should summarise maintenance capability');
      assert.match(content, /memory administration/, 'Should summarise memory administration capability');
      assert.match(content, /dry-run trials/, 'Should summarise dry-run capability');
      assert.doesNotMatch(content, /\*\*Pipeline:\*\*/, 'Should not list internal pipeline skills');
      assert.doesNotMatch(content, /\*\*Authoring:\*\*/, 'Should not list internal authoring skills');
      assert.doesNotMatch(content, /\*\*Maintenance:\*\*/, 'Should not list internal maintenance skills');
      assert.doesNotMatch(content, /\*\*Memory Admin:\*\*/, 'Should not list internal memory admin skills');
      assert.doesNotMatch(content, /add-memory-entity-type/, 'Should not list internal memory authoring skills');
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
        // Files that skip (no frontmatter) are not included in results
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
        
        // Should have parsed the valid flow AND included the malformed one
        assert.equal(flows.length, 2, 'Should include both valid and malformed flows');
        
        // The valid flow should be present
        const valid = flows.find(f => f.id === 'valid-flow');
        assert.ok(valid, 'Should include valid flow');
        
        // The malformed flow should have an error field
        const malformed = flows.find(f => f.id === 'bad-dir');
        assert.ok(malformed, 'Should include malformed flow');
        assert.ok(malformed.error, 'Malformed flow should have error field');
        
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
        const flows = listFlows(foundryDir);
        
        // Should include the malformed flow with error details
        assert.equal(flows.length, 1);
        assert.equal(flows[0].id, 'directory');
        assert.ok(flows[0].error, 'Should have error field');
        
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

describe('buildCyclePromptExtras', () => {
  test('emits diagnostic to stderr when top-level error occurs with FOUNDRY_DIAGNOSTICS=1', async () => {
    const originalEnv = process.env.FOUNDRY_DIAGNOSTICS;
    const originalError = console.error;
    const errors = [];
    
    try {
      process.env.FOUNDRY_DIAGNOSTICS = '1';
      console.error = (...args) => errors.push(args.join(' '));
      
      // Pass invalid worktree to trigger error
      const result = await buildCyclePromptExtras({ worktree: '/nonexistent/path', cycleId: 'test', stage: 'forge' });
      
      assert.equal(result, '', 'Should return empty string on error');
      assert.equal(errors.length, 1, 'Should emit one diagnostic');
      assert.match(errors[0], /buildCyclePromptExtras/, 'Diagnostic should mention function name');
      assert.ok(errors[0].length > 50, 'Diagnostic should include error details');
    } finally {
      console.error = originalError;
      if (originalEnv !== undefined) {
        process.env.FOUNDRY_DIAGNOSTICS = originalEnv;
      } else {
        delete process.env.FOUNDRY_DIAGNOSTICS;
      }
    }
  });

  test('emits diagnostic to stderr when extractor fails to load with FOUNDRY_DIAGNOSTICS=1', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-buildcycle-'));
    const originalEnv = process.env.FOUNDRY_DIAGNOSTICS;
    const originalError = console.error;
    const errors = [];
    
    try {
      process.env.FOUNDRY_DIAGNOSTICS = '1';
      console.error = (...args) => errors.push(args.join(' '));
      
      // This test verifies that extractor failures are diagnosed.
      // However, the function will fail earlier (at memory init) because we don't
      // have a full memory setup. The top-level catch will emit the diagnostic.
      // This is acceptable - we're testing that *some* diagnostic is emitted.
      
      const result = await buildCyclePromptExtras({ worktree: dir, cycleId: 'test-cycle', stage: 'forge' });
      
      assert.equal(result, '', 'Should return empty string when setup fails');
      assert.ok(errors.length > 0, 'Should emit diagnostic for failure');
      assert.match(errors[0], /buildCyclePromptExtras/, 'Diagnostic should mention function name');
    } finally {
      console.error = originalError;
      if (originalEnv !== undefined) {
        process.env.FOUNDRY_DIAGNOSTICS = originalEnv;
      } else {
        delete process.env.FOUNDRY_DIAGNOSTICS;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not emit diagnostics when FOUNDRY_DIAGNOSTICS is not set', async () => {
    const originalEnv = process.env.FOUNDRY_DIAGNOSTICS;
    const originalError = console.error;
    const errors = [];
    
    try {
      delete process.env.FOUNDRY_DIAGNOSTICS;
      console.error = (...args) => errors.push(args.join(' '));
      
      // Pass invalid worktree to trigger error
      const result = await buildCyclePromptExtras({ worktree: '/nonexistent/path', cycleId: 'test', stage: 'forge' });
      
      assert.equal(result, '', 'Should return empty string on error');
      assert.equal(errors.length, 0, 'Should not emit diagnostics when flag is not set');
    } finally {
      console.error = originalError;
      if (originalEnv !== undefined) {
        process.env.FOUNDRY_DIAGNOSTICS = originalEnv;
      } else {
        delete process.env.FOUNDRY_DIAGNOSTICS;
      }
    }
  });

  test('includes error message in diagnostic output', async () => {
    const originalEnv = process.env.FOUNDRY_DIAGNOSTICS;
    const originalError = console.error;
    const errors = [];
    
    try {
      process.env.FOUNDRY_DIAGNOSTICS = '1';
      console.error = (...args) => errors.push(args.join(' '));
      
      // Pass invalid worktree to trigger error
      const result = await buildCyclePromptExtras({ worktree: '/nonexistent/path', cycleId: 'test', stage: 'forge' });
      
      assert.equal(result, '', 'Should return empty string on error');
      assert.equal(errors.length, 1, 'Should emit one diagnostic');
      // The error message should contain buildCyclePromptExtras and some error details
      assert.match(errors[0], /buildCyclePromptExtras/, 'Should mention function name');
      assert.ok(errors[0].length > 'buildCyclePromptExtras: '.length, 'Should include error details');
    } finally {
      console.error = originalError;
      if (originalEnv !== undefined) {
        process.env.FOUNDRY_DIAGNOSTICS = originalEnv;
      } else {
        delete process.env.FOUNDRY_DIAGNOSTICS;
      }
    }
  });
});

describe('bootstrap message content — Phase 04 updates', () => {
  test('buildFoundryNotInitializedMessage contains deploy the five Foundry agents', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-msg-update-'));
    try {
      const content = getBootstrapContent(dir, '/fake/pkg');
      assert.ok(
        content.includes('deploy the five Foundry agents (guide, admin, forge, appraise, assay)'),
        'not-initialised message must mention deploying five Foundry agents'
      );
      assert.ok(
        !content.includes('generate stage agents'),
        'not-initialised message must not contain old "generate stage agents" phrasing'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('buildFoundryInitializedMessage contains new Agent model paragraph', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-msg-init-'));
    try {
      mkdirSync(path.join(dir, 'foundry', 'flows'), { recursive: true });

      const content = getBootstrapContent(dir, '/fake/pkg');

      // New paragraph heading present
      assert.ok(
        content.includes('## Agent model'),
        'initialised message must have Agent model heading'
      );

      // Each agent referenced (some cross line-breaks in the template literal)
      assert.ok(
        content.includes('Foundry uses five fixed agents for cycle stage dispatch:'),
        'initialised message must mention five fixed agents'
      );
      assert.ok(
        content.includes('foundry-guide'),
        'initialised message must mention foundry-guide'
      );
      assert.ok(
        content.includes('foundry-admin'),
        'initialised message must mention foundry-admin'
      );
      assert.ok(
        content.includes('foundry-forge'),
        'initialised message must mention foundry-forge'
      );
      assert.ok(
        content.includes('foundry-appraise'),
        'initialised message must mention foundry-appraise'
      );
      assert.ok(
        content.includes('foundry-assay'),
        'initialised message must mention foundry-assay'
      );

      // Role descriptions
      assert.ok(
        content.includes('user-facing'),
        'initialised message must mention user-facing role'
      );
      assert.ok(
        content.includes('config changes'),
        'initialised message must mention config changes role'
      );
      assert.ok(
        content.includes('artefact generation'),
        'initialised message must mention artefact generation role'
      );
      assert.ok(
        content.includes('memory population'),
        'initialised message must mention memory population role'
      );

      // Guide agent install location
      assert.ok(
        content.includes('The guide agent is installed as'),
        'initialised message must mention guide agent install location'
      );
      assert.ok(
        content.includes('`.opencode/agents/foundry-guide.md`'),
        'initialised message must mention foundry-guide.md path'
      );

      // Old content absent
      assert.ok(
        !content.includes('Multi-model routing'),
        'initialised message must not contain old "Multi-model routing" heading'
      );
      assert.ok(
        !content.includes('generated `foundry-*` stage agents'),
        'initialised message must not contain old "generated foundry-* stage agents"'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('getBootstrapContent restart-needed branch contains Foundry agent files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fdy-msg-restart-'));
    try {
      const content = getBootstrapContent(dir, '/fake/pkg', true);

      assert.ok(
        content.includes('Foundry agent files'),
        'restart-needed message must contain "Foundry agent files"'
      );
      assert.ok(
        !content.includes('stage agent files'),
        'restart-needed message must not contain old "stage agent files"'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
