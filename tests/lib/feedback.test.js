import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFeedbackItem,
  parseFeedback,
  addFeedbackItem,
  actionFeedbackItem,
  wontfixFeedbackItem,
  resolveFeedbackItem,
  listFeedback,
  detectDeadlocks,
} from '../../scripts/lib/feedback.js';

// ---------------------------------------------------------------------------
// parseFeedbackItem
// ---------------------------------------------------------------------------

describe('parseFeedbackItem', () => {
  it('parses open item', () => {
    const r = parseFeedbackItem('- [ ] fix the bug #validation');
    assert.equal(r.state, 'open');
    assert.equal(r.resolved, false);
    assert.deepEqual(r.tags, ['#validation']);
  });

  it('parses actioned item', () => {
    const r = parseFeedbackItem('- [x] fix the bug #validation');
    assert.equal(r.state, 'actioned');
    assert.equal(r.resolved, false);
  });

  it('parses wont-fix item', () => {
    const r = parseFeedbackItem('- [~] fix the bug #validation | wont-fix: not needed');
    assert.equal(r.state, 'wont-fix');
    assert.equal(r.resolved, false);
  });

  it('parses approved item', () => {
    const r = parseFeedbackItem('- [x] fix the bug #validation | approved');
    assert.equal(r.state, 'actioned');
    assert.equal(r.resolved, true);
  });

  it('parses rejected item', () => {
    const r = parseFeedbackItem('- [x] fix the bug #validation | rejected');
    assert.equal(r.state, 'rejected');
    assert.equal(r.resolved, false);
  });

  it('returns unknown for non-standard checkbox', () => {
    const r = parseFeedbackItem('- [?] something');
    assert.equal(r.state, 'unknown');
  });
});

// ---------------------------------------------------------------------------
// parseFeedback
// ---------------------------------------------------------------------------

describe('parseFeedback', () => {
  const artefacts = [
    { file: 'foo.md', cycle: 'write' },
    { file: 'bar.js', cycle: 'build' },
  ];

  it('returns items under matching cycle file', () => {
    const text = [
      '# Feedback',
      '## foo.md',
      '- [ ] item one #validation',
      '- [x] item two #validation',
    ].join('\n');
    const r = parseFeedback(text, 'write', artefacts);
    assert.equal(r.length, 2);
    assert.equal(r[0].state, 'open');
    assert.equal(r[1].state, 'actioned');
  });

  it('ignores items under non-cycle files', () => {
    const text = [
      '# Feedback',
      '## bar.js',
      '- [ ] item one #validation',
    ].join('\n');
    const r = parseFeedback(text, 'write', artefacts);
    assert.equal(r.length, 0);
  });

  it('stops at next heading at same level', () => {
    const text = [
      '# Feedback',
      '## foo.md',
      '- [ ] item #validation',
      '# Other Section',
      '## foo.md',
      '- [ ] should not appear #validation',
    ].join('\n');
    const r = parseFeedback(text, 'write', artefacts);
    assert.equal(r.length, 1);
  });

  it('supports h2 Feedback variant', () => {
    const text = [
      '## Feedback',
      '### foo.md',
      '- [ ] item #validation',
    ].join('\n');
    const r = parseFeedback(text, 'write', artefacts);
    assert.equal(r.length, 1);
  });

  it('collects all feedback when artefacts list is empty', () => {
    const text = [
      '## Feedback',
      '### haikus/test.md',
      '- [ ] imagery is too vague #law:vivid-imagery',
      '- [ ] too conventional #law:bold-risk-taking-style',
    ].join('\n');
    const r = parseFeedback(text, 'create-haiku', []);
    assert.equal(r.length, 2);
    assert.equal(r[0].state, 'open');
    assert.equal(r[1].state, 'open');
  });
});

// ---------------------------------------------------------------------------
// addFeedbackItem
// ---------------------------------------------------------------------------

describe('addFeedbackItem', () => {
  it('adds under existing heading', () => {
    const text = [
      '## Feedback',
      '### foo.md',
      '- [ ] existing #validation',
    ].join('\n');
    const result = addFeedbackItem(text, 'foo.md', 'new item', 'validation');
    assert.ok(result.includes('- [ ] new item #validation'));
    assert.ok(result.indexOf('existing') < result.indexOf('new item'));
  });

  it('creates section and heading when missing', () => {
    const text = '# Title\n\nSome content';
    const result = addFeedbackItem(text, 'foo.md', 'item', 'validation');
    assert.ok(result.includes('## Feedback'));
    assert.ok(result.includes('### foo.md'));
    assert.ok(result.includes('- [ ] item #validation'));
  });

  it('creates heading under existing section', () => {
    const text = [
      '## Feedback',
      '### bar.js',
      '- [ ] bar item #validation',
    ].join('\n');
    const result = addFeedbackItem(text, 'foo.md', 'new', 'hitl');
    assert.ok(result.includes('### foo.md'));
    assert.ok(result.includes('- [ ] new #hitl'));
  });
});

// ---------------------------------------------------------------------------
// actionFeedbackItem
// ---------------------------------------------------------------------------

describe('actionFeedbackItem', () => {
  it('changes correct item by index', () => {
    const text = [
      '## Feedback',
      '### foo.md',
      '- [ ] first #validation',
      '- [ ] second #validation',
    ].join('\n');
    const result = actionFeedbackItem(text, 'foo.md', 1);
    assert.ok(result.includes('- [ ] first'));
    assert.ok(result.includes('- [x] second'));
  });
});

// ---------------------------------------------------------------------------
// wontfixFeedbackItem
// ---------------------------------------------------------------------------

describe('wontfixFeedbackItem', () => {
  it('changes checkbox and appends reason', () => {
    const text = [
      '## Feedback',
      '### foo.md',
      '- [ ] fix thing #validation',
    ].join('\n');
    const result = wontfixFeedbackItem(text, 'foo.md', 0, 'out of scope');
    assert.ok(result.includes('- [~] fix thing #validation | wont-fix: out of scope'));
  });
});

// ---------------------------------------------------------------------------
// resolveFeedbackItem
// ---------------------------------------------------------------------------

describe('resolveFeedbackItem', () => {
  it('approves an item', () => {
    const text = [
      '## Feedback',
      '### foo.md',
      '- [x] done thing #validation',
    ].join('\n');
    const result = resolveFeedbackItem(text, 'foo.md', 0, 'approved');
    assert.ok(result.includes('| approved'));
  });

  it('rejects with reason', () => {
    const text = [
      '## Feedback',
      '### foo.md',
      '- [x] done thing #validation',
    ].join('\n');
    const result = resolveFeedbackItem(text, 'foo.md', 0, 'rejected', 'not good enough');
    assert.ok(result.includes('| rejected: not good enough'));
  });
});

// ---------------------------------------------------------------------------
// listFeedback
// ---------------------------------------------------------------------------

describe('listFeedback', () => {
  const artefacts = [
    { file: 'a.md', cycle: 'c1' },
    { file: 'b.md', cycle: 'c1' },
  ];

  const text = [
    '## Feedback',
    '### a.md',
    '- [ ] alpha #validation',
    '- [x] beta #hitl',
    '### b.md',
    '- [ ] gamma #validation',
  ].join('\n');

  it('returns structured output', () => {
    const r = listFeedback(text, 'c1', artefacts);
    assert.equal(r.length, 3);
    assert.equal(r[0].file, 'a.md');
    assert.equal(r[0].index, 0);
    assert.equal(r[0].state, 'open');
    assert.equal(r[1].index, 1);
    assert.equal(r[2].file, 'b.md');
    assert.equal(r[2].index, 0);
  });

  it('filters by file', () => {
    const r = listFeedback(text, 'c1', artefacts, 'b.md');
    assert.equal(r.length, 1);
    assert.equal(r[0].file, 'b.md');
  });
});

// ---------------------------------------------------------------------------
// detectDeadlocks
// ---------------------------------------------------------------------------

describe('detectDeadlocks', () => {
  it('returns empty when no feedback', () => {
    assert.deepEqual(detectDeadlocks([], []), []);
  });

  it('detects feedback that has been rejected multiple times', () => {
    const feedback = [
      { file: 'haiku.md', index: 0, text: 'tone is wrong', tag: 'law:dark-moody-tone', state: 'rejected' },
    ];
    const history = [
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
    ];
    const result = detectDeadlocks(feedback, history, 3);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, 'tone is wrong');
  });

  it('returns empty when under threshold', () => {
    const feedback = [
      { file: 'haiku.md', index: 0, text: 'tone is wrong', tag: 'law:dark-moody-tone', state: 'rejected' },
    ];
    const history = [
      { stage: 'forge:write', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
    ];
    assert.deepEqual(detectDeadlocks(feedback, history, 3), []);
  });

  it('includes open items in deadlock', () => {
    const feedback = [
      { state: 'open', text: 'still open' },
      { state: 'actioned', resolved: true, text: 'resolved' },
    ];
    const history = [
      { stage: 'appraise:check', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
      { stage: 'appraise:check', cycle: 'c1' },
    ];
    const result = detectDeadlocks(feedback, history, 3);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, 'still open');
  });
});
