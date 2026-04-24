# Phase 1: Feedback Store + State Machine

**Scope:** New `scripts/lib/ulid.js`, new `scripts/lib/feedback-store.js`, rewritten `scripts/lib/feedback-transitions.js`, plus unit tests. No existing callers are touched yet — phase 1 adds capability; phases 3 and 4 wire it up.

**Spec sections covered:** §4 (data model), §5 (state machine), §8.3 (dedup), §9.1 (file format), §14.1 (store unit tests). Atomicity (§9.2) is exercised in tests via a mock `rename`; the real IO shim gets the capability in phase 2.

**Files in this phase:**
- Create: `scripts/lib/ulid.js`
- Create: `scripts/lib/feedback-store.js`
- Rewrite: `scripts/lib/feedback-transitions.js`
- Create: `tests/lib/ulid.test.js`
- Create: `tests/lib/feedback-store.test.js`
- **Rewrite (delete then re-create)**: `tests/lib/feedback-transitions.test.js` — per REVISION-CONTRACT §C1 M5, the existing file contents must be deleted before writing the new contents (it contains legacy positional-argument tests incompatible with the new options-object API).

**Preflight (run these once at phase start):**

```bash
# Confirm feedback-transitions test file exists
ls tests/lib/feedback-transitions.test.js 2>&1 || echo "create new"

# Confirm no collision with planned filenames
ls scripts/lib/ulid.js scripts/lib/feedback-store.js 2>&1
# Expect: "No such file or directory" for both.

# Baseline
npm test
# Expect: all green. Record the passing test count — you'll check it grows, never regresses.
```

---

## Task 1.1: ULID generator (RED)

**Files:** Create `tests/lib/ulid.test.js`.

- [ ] **Step 1: Write the failing test**

```js
// tests/lib/ulid.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ulid, createUlidGenerator } from '../../scripts/lib/ulid.js';

describe('ulid', () => {
  test('returns a 26-character string', () => {
    const id = ulid();
    assert.equal(typeof id, 'string');
    assert.equal(id.length, 26);
  });

  test('uses Crockford base32 alphabet', () => {
    // Crockford base32: 0123456789ABCDEFGHJKMNPQRSTVWXYZ (no I L O U)
    const id = ulid();
    assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('is monotonic when called repeatedly from a fresh generator', () => {
    // Use a fresh generator so this test does not interact with state
    // accumulated by the shared default `ulid` instance in other tests.
    const gen = createUlidGenerator();
    const ids = [];
    for (let i = 0; i < 50; i++) ids.push(gen());
    const sorted = [...ids].sort();
    assert.deepEqual(ids, sorted, 'ids should be monotonically sorted');
  });

  test('produces unique ids across rapid calls', () => {
    const gen = createUlidGenerator();
    const set = new Set();
    for (let i = 0; i < 1000; i++) set.add(gen());
    assert.equal(set.size, 1000);
  });

  test('accepts a custom timestamp for deterministic testing', () => {
    const gen = createUlidGenerator();
    const id = gen(1700000000000);
    // First 10 chars = timestamp component; should match across calls with same ts.
    const id2 = gen(1700000000000);
    assert.equal(id.slice(0, 10), id2.slice(0, 10));
  });

  test('createUlidGenerator instances are independent (no shared state)', () => {
    const genA = createUlidGenerator();
    const genB = createUlidGenerator();
    // Same timestamp to both; different generators should still produce valid
    // 26-char IDs without monotonicity contaminating each other.
    const a = genA(1700000000000);
    const b = genB(1700000000000);
    assert.equal(a.length, 26);
    assert.equal(b.length, 26);
    assert.equal(a.slice(0, 10), b.slice(0, 10), 'timestamp prefix matches');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/lib/ulid.test.js`
Expected: FAIL with `Cannot find module '../../scripts/lib/ulid.js'` (ERR_MODULE_NOT_FOUND).

---

## Task 1.2: ULID generator (GREEN)

**Files:** Create `scripts/lib/ulid.js`.

- [ ] **Step 1: Implement ULID**

```js
// scripts/lib/ulid.js
import { randomBytes } from 'node:crypto';

// Crockford's base32 alphabet (excludes I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// ULID spec: 10 chars of timestamp (48-bit ms since epoch) + 16 chars of randomness (80 bits).
// We make the randomness monotonic within the same millisecond by incrementing the previous
// random component by 1 whenever the timestamp hasn't advanced.

function encodeTime(ms) {
  let out = '';
  for (let i = 9; i >= 0; i--) {
    out = ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function randomIndexes() {
  const bytes = randomBytes(10); // 80 bits
  const out = new Array(16);
  // Pack 80 bits into 16 5-bit groups.
  let bitBuffer = 0;
  let bits = 0;
  let j = 0;
  for (let i = 0; i < bytes.length; i++) {
    bitBuffer = (bitBuffer << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out[j++] = (bitBuffer >>> bits) & 31;
    }
  }
  return out;
}

function incrementRandom(arr) {
  // Increment as a base-32 little-endian-ish counter from the right.
  const next = arr.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i] < 31) { next[i] += 1; return next; }
    next[i] = 0;
  }
  // Overflow across all 80 bits: re-seed. Extraordinarily unlikely.
  return randomIndexes();
}

/**
 * Creates an independent ULID generator with its own monotonicity state.
 *
 * Monotonicity state (lastTime, lastRandom) is kept in closure, not module
 * scope, so tests can instantiate isolated generators and production code
 * can import a single shared instance without cross-test contamination.
 *
 * @returns {(now?: number) => string} generator function
 */
export function createUlidGenerator() {
  let lastTime = 0;
  let lastRandom = null; // array of 16 base32 char indexes

  return function ulid(now = Date.now()) {
    let randArr;
    if (now === lastTime && lastRandom) {
      randArr = incrementRandom(lastRandom);
    } else {
      randArr = randomIndexes();
    }
    lastTime = now;
    lastRandom = randArr;
    const rand = randArr.map(i => ALPHABET[i]).join('');
    return encodeTime(now) + rand;
  };
}

// Default shared generator — preserves ergonomic `import { ulid }` usage.
// Tests that need deterministic, isolated state should call createUlidGenerator().
export const ulid = createUlidGenerator();
```

- [ ] **Step 2: Run tests and confirm pass**

Run: `node --test tests/lib/ulid.test.js`
Expected: all 5 tests pass.

- [ ] **Step 3: Run full suite to confirm no regressions**

Run: `npm test`
Expected: test count increased by 5; previously-green tests remain green.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/ulid.js tests/lib/ulid.test.js
git commit -m "feat(ulid): minimal ULID generator for feedback item ids

Adds a dependency-free ULID implementation used by the upcoming
WORK.feedback.yaml store. Guarantees 26-char Crockford base32 output,
strict monotonicity within the same millisecond, and acceptance of an
injected timestamp for deterministic tests.

Exports createUlidGenerator() factory so monotonicity state lives in
closure rather than module scope; tests instantiate isolated generators
to avoid cross-test contamination. The default named export 'ulid' is
a shared instance created by the factory for ergonomic imports."
```

---

## Task 1.3: State-machine matrix (RED)

**Files:** Read/inspect `scripts/lib/feedback-transitions.js` (current form). Rewrite `tests/lib/feedback-transitions.test.js`.

Spec §5.1 defines 6 legal transition rules. The new matrix enumerates them explicitly.

**File-rewrite instruction (per REVISION-CONTRACT §C1 M5):** **Delete existing file contents first, then write new contents.** The existing `tests/lib/feedback-transitions.test.js` contains legacy tests that call `validateTransition('open', 'actioned', 'forge')` positionally. Under the new options-object signature these would throw `unknown state: undefined` and pollute the test output. Do not append to the file; overwrite it entirely.

```bash
# Explicit reset before writing:
rm -f tests/lib/feedback-transitions.test.js
```

- [ ] **Step 1: Write the failing tests**

```js
// tests/lib/feedback-transitions.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateTransition, hashText } from '../../scripts/lib/feedback-transitions.js';

describe('validateTransition — forge transitions', () => {
  test('forge: open → actioned is legal', () => {
    assert.deepEqual(
      validateTransition({ currentState: 'open', target: 'actioned', stageBase: 'forge', sourceMatches: false }),
      { ok: true }
    );
  });
  test('forge: open → wont-fix is legal', () => {
    assert.deepEqual(
      validateTransition({ currentState: 'open', target: 'wont-fix', stageBase: 'forge', sourceMatches: false }),
      { ok: true }
    );
  });
  test('forge: rejected → actioned is legal', () => {
    assert.deepEqual(
      validateTransition({ currentState: 'rejected', target: 'actioned', stageBase: 'forge', sourceMatches: false }),
      { ok: true }
    );
  });
  test('forge: rejected → wont-fix is legal', () => {
    assert.deepEqual(
      validateTransition({ currentState: 'rejected', target: 'wont-fix', stageBase: 'forge', sourceMatches: false }),
      { ok: true }
    );
  });
  test('forge: actioned → anything is rejected', () => {
    const r = validateTransition({ currentState: 'actioned', target: 'resolved', stageBase: 'forge', sourceMatches: false });
    assert.equal(r.ok, false);
  });
  test('forge: cannot operate on deadlocked', () => {
    const r = validateTransition({ currentState: 'deadlocked', target: 'actioned', stageBase: 'forge', sourceMatches: false });
    assert.equal(r.ok, false);
  });
  test('forge: cannot operate on resolved', () => {
    const r = validateTransition({ currentState: 'resolved', target: 'actioned', stageBase: 'forge', sourceMatches: false });
    assert.equal(r.ok, false);
  });
});

describe('validateTransition — source-stage transitions', () => {
  const source = 'appraise:write-check';

  test('actioned → resolved requires matching source', () => {
    const ok = validateTransition({ currentState: 'actioned', target: 'resolved', stageBase: 'appraise', sourceMatches: true });
    assert.equal(ok.ok, true);
    const bad = validateTransition({ currentState: 'actioned', target: 'resolved', stageBase: 'appraise', sourceMatches: false });
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /source/);
  });
  test('wont-fix → rejected is legal when source matches', () => {
    const r = validateTransition({ currentState: 'wont-fix', target: 'rejected', stageBase: 'appraise', sourceMatches: true });
    assert.equal(r.ok, true);
  });
  test('quench can resolve only items it sourced', () => {
    const good = validateTransition({ currentState: 'actioned', target: 'resolved', stageBase: 'quench', sourceMatches: true });
    assert.equal(good.ok, true);
    const bad = validateTransition({ currentState: 'actioned', target: 'resolved', stageBase: 'quench', sourceMatches: false });
    assert.equal(bad.ok, false);
  });
  test('human-appraise can resolve items it sourced', () => {
    const r = validateTransition({ currentState: 'actioned', target: 'resolved', stageBase: 'human-appraise', sourceMatches: true });
    assert.equal(r.ok, true);
  });
});

describe('validateTransition — deadlock override', () => {
  test('human-appraise: deadlocked → resolved legal even when source does not match', () => {
    const r = validateTransition({
      currentState: 'deadlocked',
      target: 'resolved',
      stageBase: 'human-appraise',
      sourceMatches: false,
    });
    assert.equal(r.ok, true);
  });
  test('human-appraise: deadlocked → wont-fix legal', () => {
    const r = validateTransition({
      currentState: 'deadlocked',
      target: 'wont-fix',
      stageBase: 'human-appraise',
      sourceMatches: false,
    });
    assert.equal(r.ok, true);
  });
  test('human-appraise: deadlocked → rejected legal', () => {
    const r = validateTransition({
      currentState: 'deadlocked',
      target: 'rejected',
      stageBase: 'human-appraise',
      sourceMatches: false,
    });
    assert.equal(r.ok, true);
  });
  test('appraise CANNOT touch a deadlocked item (only human-appraise overrides)', () => {
    const r = validateTransition({
      currentState: 'deadlocked',
      target: 'resolved',
      stageBase: 'appraise',
      sourceMatches: true,
    });
    assert.equal(r.ok, false);
  });
  test('forge CANNOT touch a deadlocked item', () => {
    const r = validateTransition({
      currentState: 'deadlocked',
      target: 'actioned',
      stageBase: 'forge',
      sourceMatches: true,
    });
    assert.equal(r.ok, false);
  });
});

describe('validateTransition — terminal state', () => {
  test('resolved is terminal — no transitions allowed', () => {
    for (const target of ['actioned', 'wont-fix', 'rejected', 'resolved', 'deadlocked', 'open']) {
      for (const stage of ['forge', 'quench', 'appraise', 'human-appraise']) {
        const r = validateTransition({ currentState: 'resolved', target, stageBase: stage, sourceMatches: true });
        assert.equal(r.ok, false, `resolved → ${target} from ${stage} must be rejected`);
      }
    }
  });
});

describe('validateTransition — unknown state', () => {
  test('returns ok:false with a clear reason', () => {
    const r = validateTransition({ currentState: 'bogus', target: 'actioned', stageBase: 'forge', sourceMatches: false });
    assert.equal(r.ok, false);
    assert.match(r.reason, /unknown state/);
  });
});

describe('hashText', () => {
  test('stable for same input', () => {
    assert.equal(hashText('abc'), hashText('abc'));
  });
  test('differs for different input', () => {
    assert.notEqual(hashText('abc'), hashText('abd'));
  });
  test('returns a 16-char hex string', () => {
    assert.match(hashText('anything'), /^[0-9a-f]{16}$/);
  });
});
```

- [ ] **Step 2: Run and confirm failure for the right reason**

Run: `node --test tests/lib/feedback-transitions.test.js`
Expected: tests fail because the current `validateTransition` signature is `(current, target, stageBase)` (positional), not an options object, AND because the matrix does not include the new `deadlocked`/`resolved` states or the source-authorship rule.

If tests fail with `TypeError: Cannot read properties of undefined` on the old module, good — that confirms the API shape is the problem. If they pass, the matrix secretly already handles it and we need to re-read the current implementation.

---

## Task 1.4: State-machine matrix (GREEN)

**Files:** Rewrite `scripts/lib/feedback-transitions.js`.

- [ ] **Step 1: Implement the new matrix**

```js
// scripts/lib/feedback-transitions.js
import { createHash } from 'node:crypto';

// State machine per spec §5.
//
// States: open, actioned, wont-fix, rejected, deadlocked, resolved (terminal).
//
// Transition rules (spec §5.1):
//   1. Forge operates on {open, rejected} → {actioned, wont-fix}.
//   2. Source-stage (quench/appraise/human-appraise) operates on {actioned, wont-fix}
//      → {resolved, rejected}, but only when caller's stageId === item.source.
//   3. Sort (and only sort) writes 'deadlocked'. NOT validated here — sort bypasses
//      this function. Included for completeness: no stage-base is allowed to produce
//      'deadlocked' through this function.
//   4. Human-appraise override: on a deadlocked item, transitions to
//      {resolved, wont-fix, rejected} are legal regardless of source match.
//   5. 'resolved' is terminal.
//
// validateTransition takes an options object so new dimensions (sourceMatches,
// potential future flags) don't break the call shape.

const FORGE_TARGETS = new Set(['actioned', 'wont-fix']);
const SOURCE_TARGETS = new Set(['resolved', 'rejected']);
const HUMAN_OVERRIDE_TARGETS = new Set(['resolved', 'wont-fix', 'rejected']);
const KNOWN_STATES = new Set(['open', 'actioned', 'wont-fix', 'rejected', 'deadlocked', 'resolved']);

export function validateTransition({ currentState, target, stageBase, sourceMatches }) {
  if (!KNOWN_STATES.has(currentState)) {
    return { ok: false, reason: `unknown state: ${currentState}` };
  }

  if (currentState === 'resolved') {
    return { ok: false, reason: 'resolved is terminal' };
  }

  // Deadlocked: only human-appraise may transition, and only to override targets.
  if (currentState === 'deadlocked') {
    if (stageBase !== 'human-appraise') {
      return { ok: false, reason: `only human-appraise may resolve a deadlocked item; got ${stageBase}` };
    }
    if (!HUMAN_OVERRIDE_TARGETS.has(target)) {
      return { ok: false, reason: `invalid deadlock-override transition → ${target}` };
    }
    return { ok: true };
  }

  // Forge path: {open, rejected} → {actioned, wont-fix}.
  if (stageBase === 'forge') {
    if (currentState !== 'open' && currentState !== 'rejected') {
      return { ok: false, reason: `forge cannot transition from ${currentState}` };
    }
    if (!FORGE_TARGETS.has(target)) {
      return { ok: false, reason: `forge cannot produce ${target}` };
    }
    return { ok: true };
  }

  // Source-stage path: {actioned, wont-fix} → {resolved, rejected}, source must match.
  if (stageBase === 'quench' || stageBase === 'appraise' || stageBase === 'human-appraise') {
    if (currentState !== 'actioned' && currentState !== 'wont-fix') {
      return { ok: false, reason: `${stageBase} cannot transition from ${currentState}` };
    }
    if (!SOURCE_TARGETS.has(target)) {
      return { ok: false, reason: `${stageBase} cannot produce ${target}` };
    }
    if (!sourceMatches) {
      return { ok: false, reason: `only the source stage may resolve/reject this item` };
    }
    return { ok: true };
  }

  return { ok: false, reason: `unsupported stage base: ${stageBase}` };
}

export function hashText(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
```

- [ ] **Step 2: Run tests and confirm pass**

Run: `node --test tests/lib/feedback-transitions.test.js`
Expected: all tests pass.

- [ ] **Step 3: Run full suite; diagnose regressions**

Run: `npm test`
Expected: the old `scripts/lib/feedback.js` imports `validateTransition(current, target, stageBase)` positionally at line 256. **This will now break.** Phase 4 deletes `feedback.js` entirely, but we cannot land that now.

**Do NOT add an unconditional `sourceMatches: true` adapter.** Such a shim silently loosens authorship on every legacy call (spec violation per REVISION-CONTRACT §C1 B1). Instead, keep the old behaviour truly intact by exporting the **legacy matrix as a separate named export** and rewiring `feedback.js` to use it.

Add to the bottom of `scripts/lib/feedback-transitions.js`:

```js
// Legacy matrix preserved verbatim for scripts/lib/feedback.js (the old
// markdown-based flow). New code MUST use validateTransition (options-
// object form) above. This export is deleted in phase 4 alongside
// feedback.js itself. Keep semantics identical to the pre-phase-1 matrix.
export const legacyTransitionsMatrix = {
  open:       { actioned: ['forge'],  'wont-fix': ['forge'] },
  actioned:   { approved: ['quench','appraise','human-appraise'], rejected: ['quench','appraise','human-appraise'] },
  'wont-fix': { approved: ['appraise','human-appraise'],          rejected: ['appraise','human-appraise'] },
  rejected:   { actioned: ['forge'],  'wont-fix': ['forge'] },
  approved:   {},
};

export function legacyValidateTransition(current, target, stageBase) {
  const row = legacyTransitionsMatrix[current];
  if (!row) return { ok: false, reason: `unknown state: ${current}` };
  const allowed = row[target];
  if (!allowed) return { ok: false, reason: `illegal transition ${current} → ${target}` };
  if (!allowed.includes(stageBase)) {
    return { ok: false, reason: `${stageBase} cannot produce ${target} from ${current}` };
  }
  return { ok: true };
}
```

Then update `scripts/lib/feedback.js:256` (the ONE existing caller) to use the legacy export by name:

```js
// OLD: import { validateTransition } from './feedback-transitions.js';
//      const v = validateTransition(current, target, stageBase);
import { legacyValidateTransition } from './feedback-transitions.js';
// ...at line 256:
const v = legacyValidateTransition(current, target, stageBase);
```

This preserves the exact pre-phase-1 authorship rules for every legacy call site. Phase 4 deletes `feedback.js`, `legacyTransitionsMatrix`, and `legacyValidateTransition` in one commit.

Run: `npm test`
Expected: all tests green again — legacy callers use the legacy matrix unchanged; new callers (phase 3+) use the new `validateTransition`.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/feedback-transitions.js tests/lib/feedback-transitions.test.js scripts/lib/feedback.js
git commit -m "feat(feedback-transitions): rewrite state machine for six-state model

Introduces the six-state machine (open | actioned | wont-fix | rejected |
deadlocked | resolved) defined in the WORK.feedback.yaml redesign spec.
Switches validateTransition to an options-object signature carrying a
sourceMatches flag so the source-stage authorship rule can be enforced.

Preserves the pre-phase-1 matrix verbatim as legacyTransitionsMatrix /
legacyValidateTransition and rewires scripts/lib/feedback.js to use the
legacy export by name. No authorship semantics change for legacy callers;
phase 4 deletes feedback.js and the legacy exports in one commit."
```

---

## Task 1.4.5: `canForgeWontFix` predicate (RED → GREEN)

**Files:** Extend `tests/lib/feedback-transitions.test.js` and `scripts/lib/feedback-transitions.js`.

Per REVISION-CONTRACT §A2 / spec §5.1 rule 7: forge may transition to `wont-fix` only when `item.source` base is `appraise`. When the source base is `quench` or `human-appraise`, forge's only legal transition from `{open, rejected}` is to `actioned`. This task adds the predicate that encodes that rule; the predicate is called from `store.transition` in task 1.8 and re-used by plugin tools in phase 3.

- [ ] **Step 1: Write the failing tests (RED)**

Append this block to `tests/lib/feedback-transitions.test.js`:

```js
import { canForgeWontFix } from '../../scripts/lib/feedback-transitions.js';

describe('canForgeWontFix — A2 source-scoped wont-fix', () => {
  // Matrix: 3 source bases × 2 target states (actioned, wont-fix).
  // Only forge→wont-fix is affected; the predicate is source-agnostic for
  // the 'actioned' target (always true when called, since forge can always
  // produce 'actioned'). We express the rule as a pure predicate on
  // (item.source base, target) and exercise all 3 source bases.

  test('appraise-sourced item: forge can wont-fix', () => {
    const item = { source: 'appraise:write-check' };
    assert.equal(canForgeWontFix(item, 'forge'), true);
  });

  test('quench-sourced item: forge CANNOT wont-fix', () => {
    const item = { source: 'quench:schema' };
    assert.equal(canForgeWontFix(item, 'forge'), false);
  });

  test('human-appraise-sourced item: forge CANNOT wont-fix', () => {
    const item = { source: 'human-appraise:review' };
    assert.equal(canForgeWontFix(item, 'forge'), false);
  });

  test('non-forge caller: predicate is only meaningful for forge base', () => {
    // The predicate is documented as forge-specific; we codify that non-forge
    // callers get `false` (they should not be asking this question).
    const item = { source: 'appraise:x' };
    assert.equal(canForgeWontFix(item, 'appraise'), false);
    assert.equal(canForgeWontFix(item, 'quench'), false);
    assert.equal(canForgeWontFix(item, 'human-appraise'), false);
  });

  test('malformed source returns false (defensive)', () => {
    assert.equal(canForgeWontFix({ source: '' }, 'forge'), false);
    assert.equal(canForgeWontFix({ source: null }, 'forge'), false);
  });
});
```

- [ ] **Step 2: Run and confirm failure for the right reason**

Run: `node --test tests/lib/feedback-transitions.test.js`
Expected: FAIL with `SyntaxError: The requested module '../../scripts/lib/feedback-transitions.js' does not provide an export named 'canForgeWontFix'`. This is the RED reason — the function does not yet exist.

- [ ] **Step 3: Implement the predicate (GREEN)**

Append to `scripts/lib/feedback-transitions.js`:

```js
/**
 * Per spec §5.1 rule 7 (REVISION-CONTRACT §A2): forge may produce the
 * `wont-fix` target only for items whose source stage base is `appraise`.
 * For `quench`- or `human-appraise`-sourced items, forge's only legal
 * target from {open, rejected} is `actioned`.
 *
 * The predicate is forge-specific. Non-forge callers always receive
 * `false` — they should use validateTransition directly, not this helper.
 *
 * @param {{source: string}} item — feedback item; `source` is `base:alias`.
 * @param {string} callerStageBase — the caller's stage base (e.g. 'forge').
 * @returns {boolean}
 */
export function canForgeWontFix(item, callerStageBase) {
  if (callerStageBase !== 'forge') return false;
  if (!item || typeof item.source !== 'string' || !item.source) return false;
  const sourceBase = item.source.split(':')[0];
  return sourceBase === 'appraise';
}
```

- [ ] **Step 4: Run tests and confirm pass**

Run: `node --test tests/lib/feedback-transitions.test.js`
Expected: all tests pass, including the five new `canForgeWontFix` tests.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/feedback-transitions.js tests/lib/feedback-transitions.test.js
git commit -m 'feat(feedback-transitions): canForgeWontFix predicate (spec rule 7)

Forge may only produce the wont-fix target for items whose source stage
base is appraise. quench- and human-appraise-sourced items remain
actionable by forge, but cannot be marked wont-fix. The predicate is
called from store.transition (task 1.8) and re-used by the plugin
feedback tools in phase 3.

Implements REVISION-CONTRACT §A2 / spec §5.1 rule 7.'
```

---

## Task 1.5: Feedback store — schema + ULID round-trip (RED)

**Files:** Create `tests/lib/feedback-store.test.js`. Inspect `tests/lib/history.test.js` for the existing `mockIO` pattern; reuse it.

- [ ] **Step 1: Write the failing tests for the constructor + empty load**

```js
// tests/lib/feedback-store.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { openFeedbackStore } from '../../scripts/lib/feedback-store.js';

// In-memory IO shim with rename support (matches the shape used by history tests).
function mockIO(initial = {}) {
  const files = { ...initial };
  return {
    exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFile: (p) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    writeFile: (p, c) => { files[p] = c; },
    rename: (from, to) => {
      if (!Object.prototype.hasOwnProperty.call(files, from)) throw new Error(`ENOENT: ${from}`);
      files[to] = files[from];
      delete files[from];
    },
    unlink: (p) => { delete files[p]; },
    _files: files,
  };
}

describe('openFeedbackStore — empty file', () => {
  test('returns a store with empty list when file is missing', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.deepEqual(store.list(), []);
  });

  test('returns a store with empty list when file has {items: []}', () => {
    const io = mockIO({ 'WORK.feedback.yaml': yaml.dump({ items: [] }) });
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.deepEqual(store.list(), []);
  });
});

describe('openFeedbackStore — add + list round-trip', () => {
  test('adding an item persists it with the expected shape', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({
      file: 'haiku.md',
      tag: 'law:dark',
      text: 'too cheerful',
      source: 'appraise:write-check',
      cycle: 'write-haiku',
    });
    assert.equal(typeof id, 'string');
    assert.equal(id.length, 26);
    const items = store.list();
    assert.equal(items.length, 1);
    assert.equal(items[0].id, id);
    assert.equal(items[0].file, 'haiku.md');
    assert.equal(items[0].tag, 'law:dark');
    assert.equal(items[0].text, 'too cheerful');
    assert.equal(items[0].source, 'appraise:write-check');
    assert.equal(items[0].history[0].state, 'open');
    assert.equal(items[0].history[0].stage, 'appraise:write-check');
    assert.equal(items[0].history[0].cycle, 'write-haiku');
    assert.match(items[0].history[0].timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('a fresh store instance on the same io sees the persisted item', () => {
    const io = mockIO();
    const s1 = openFeedbackStore('WORK.feedback.yaml', io);
    s1.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' });
    const s2 = openFeedbackStore('WORK.feedback.yaml', io);
    assert.equal(s2.list().length, 1);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/lib/feedback-store.test.js`
Expected: `Cannot find module '../../scripts/lib/feedback-store.js'`.

---

## Task 1.6: Feedback store — schema + ULID round-trip (GREEN)

**Files:** Create `scripts/lib/feedback-store.js`.

- [ ] **Step 1: Implement the skeleton: load, add, list, atomic save**

```js
// scripts/lib/feedback-store.js
import yaml from 'js-yaml';
import { ulid } from './ulid.js';
import { validateTransition, hashText } from './feedback-transitions.js';

const YAML_OPTS = { lineWidth: -1 };

function loadItems(path, io) {
  if (!io.exists(path)) return [];
  const raw = io.readFile(path);
  if (!raw || !raw.trim()) return [];
  const doc = yaml.load(raw);
  if (doc == null) return [];
  if (typeof doc !== 'object' || !Array.isArray(doc.items)) {
    throw new Error(`WORK.feedback.yaml malformed: top-level must be an object with an 'items' array`);
  }
  return doc.items;
}

function saveItems(path, items, io) {
  const body = yaml.dump({ items }, YAML_OPTS);
  const tmp = `${path}.tmp`;
  io.writeFile(tmp, body);
  io.rename(tmp, path);
}

function nowIso() {
  return new Date().toISOString();
}

export function openFeedbackStore(path, io) {
  let items = loadItems(path, io);

  function persist() {
    saveItems(path, items, io);
  }

  function currentState(item) {
    return item.history[0].state;
  }

  return {
    list() {
      // Return defensive copies so callers cannot mutate store internals.
      return items.map(it => ({ ...it, history: it.history.map(h => ({ ...h })) }));
    },

    get(id) {
      const it = items.find(x => x.id === id);
      if (!it) return null;
      return { ...it, history: it.history.map(h => ({ ...h })) };
    },

    add({ file, tag, text, source, cycle }) {
      if (!file || !tag || !text || !source || !cycle) {
        throw new Error('add requires file, tag, text, source, cycle');
      }
      // Dedup (§8.3): non-resolved items only.
      const textHash = hashText(text);
      const existing = items.find(it =>
        it.file === file &&
        it.tag === tag &&
        hashText(it.text) === textHash &&
        currentState(it) !== 'resolved'
      );
      if (existing) {
        return { id: existing.id, deduped: true };
      }
      const id = ulid();
      const item = {
        id,
        file,
        tag,
        text,
        source,
        history: [{ state: 'open', stage: source, cycle, timestamp: nowIso() }],
      };
      items.push(item);
      persist();
      return { id, deduped: false };
    },
  };
}
```

- [ ] **Step 2: Run tests and confirm pass**

Run: `node --test tests/lib/feedback-store.test.js`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/feedback-store.js tests/lib/feedback-store.test.js
git commit -m "feat(feedback-store): yaml-backed store with add/list round-trip

Introduces scripts/lib/feedback-store.js, the new owner of all
WORK.feedback.yaml I/O. Implements the schema from spec §4 plus the
creation-path (state=open) and dedup-on-(file,tag,text) from §8.3.

Persistence uses write-temp-then-rename via the IO shim's rename method
(mock implementation in tests; real implementation added in phase 2)."
```

---

## Task 1.7: Feedback store — state transitions (RED)

**Files:** Extend `tests/lib/feedback-store.test.js`.

- [ ] **Step 1: Add transition tests**

Append this block to `tests/lib/feedback-store.test.js`:

```js
describe('store.transition — forge path', () => {
  test('open → actioned is persisted as a prepended snapshot', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' });
    const r = store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    assert.equal(r.ok, true);
    const item = store.get(id);
    assert.equal(item.history.length, 2);
    assert.equal(item.history[0].state, 'actioned');
    assert.equal(item.history[0].stage, 'forge:write');
    assert.equal(item.history[1].state, 'open');
  });

  test('wont-fix transition requires a reason', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' });
    const r = store.transition({ id, target: 'wont-fix', stage: 'forge:write', cycle: 'c' });
    assert.equal(r.ok, false);
    assert.match(r.error, /reason is required/);
  });

  test('wont-fix with reason persists reason on the snapshot', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' });
    const r = store.transition({ id, target: 'wont-fix', stage: 'forge:write', cycle: 'c', reason: 'out of scope' });
    assert.equal(r.ok, true);
    assert.equal(store.get(id).history[0].reason, 'out of scope');
  });

  test('forge cannot transition from actioned', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const r = store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    assert.equal(r.ok, false);
  });
});

describe('store.transition — source-stage authorship', () => {
  test('appraise can resolve when its stage matches item.source', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:write-check', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const r = store.transition({ id, target: 'resolved', stage: 'appraise:write-check', cycle: 'c', reason: 'addressed' });
    assert.equal(r.ok, true);
    assert.equal(store.get(id).history[0].state, 'resolved');
    assert.equal(store.get(id).history[0].reason, 'addressed');
  });

  test('resolved transition requires a reason (spec §4.3, REVISION-CONTRACT §A1)', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:write-check', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const r = store.transition({ id, target: 'resolved', stage: 'appraise:write-check', cycle: 'c' });
    assert.equal(r.ok, false);
    assert.match(r.error, /reason is required/);
  });

  test('appraise of a different stage id cannot resolve', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:write-check', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const r = store.transition({ id, target: 'resolved', stage: 'appraise:other-check', cycle: 'c', reason: 'fine' });
    assert.equal(r.ok, false);
    assert.match(r.error, /source/);
  });

  test('rejection requires a reason', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:write-check', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const bad = store.transition({ id, target: 'rejected', stage: 'appraise:write-check', cycle: 'c' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /reason is required/);
  });
});

describe('store.transition — human-appraise universal authority (A3)', () => {
  // Per REVISION-CONTRACT §A3 / spec §5.1 rule 5: human-appraise may override
  // ANY non-resolved item, not only deadlocked items. These tests exercise
  // the non-deadlocked override path that A3 locks in.

  test('human-appraise can resolve an actioned item it did NOT source', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:other', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const r = store.transition({
      id,
      target: 'resolved',
      stage: 'human-appraise:review',
      cycle: 'c',
      reason: 'approved on review',
    });
    assert.equal(r.ok, true);
    assert.equal(store.get(id).history[0].state, 'resolved');
  });

  test('human-appraise can reject a wont-fix item it did NOT source', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:other', cycle: 'c' });
    store.transition({ id, target: 'wont-fix', stage: 'forge:write', cycle: 'c', reason: 'scope' });
    const r = store.transition({
      id,
      target: 'rejected',
      stage: 'human-appraise:review',
      cycle: 'c',
      reason: 'please fix after all',
    });
    assert.equal(r.ok, true);
  });

  test('human-appraise override on non-deadlocked items still requires a reason when target needs one', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:other', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    const r = store.transition({ id, target: 'resolved', stage: 'human-appraise:review', cycle: 'c' });
    assert.equal(r.ok, false);
    assert.match(r.error, /reason is required/);
  });
});

describe('store.transition — deadlock override', () => {
  test('human-appraise can resolve deadlocked even with non-matching source', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:write-check', cycle: 'c' });
    // Force the item into deadlocked state via the internal writer used by sort.
    store.writeDeadlockedSnapshot({ id, cycle: 'c', reason: 'depth=3' });
    const r = store.transition({
      id,
      target: 'resolved',
      stage: 'human-appraise:review',
      cycle: 'c',
      reason: 'accepting as-is',
    });
    assert.equal(r.ok, true);
    assert.equal(store.get(id).history[0].state, 'resolved');
  });

  test('deadlock override requires a reason', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:write-check', cycle: 'c' });
    store.writeDeadlockedSnapshot({ id, cycle: 'c', reason: 'depth=3' });
    const r = store.transition({ id, target: 'resolved', stage: 'human-appraise:review', cycle: 'c' });
    assert.equal(r.ok, false);
    assert.match(r.error, /reason is required/);
  });

  test('appraise CANNOT override a deadlocked item', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:write-check', cycle: 'c' });
    store.writeDeadlockedSnapshot({ id, cycle: 'c', reason: 'depth=3' });
    const r = store.transition({
      id,
      target: 'resolved',
      stage: 'appraise:write-check',
      cycle: 'c',
      reason: 'trying',
    });
    assert.equal(r.ok, false);
  });
});

describe('store.transition — terminal resolved', () => {
  test('no transitions from resolved', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const { id } = store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' });
    store.transition({ id, target: 'actioned', stage: 'forge:write', cycle: 'c' });
    store.transition({ id, target: 'resolved', stage: 'appraise:a', cycle: 'c', reason: 'ok' });
    const r = store.transition({ id, target: 'rejected', stage: 'appraise:a', cycle: 'c', reason: 'x' });
    assert.equal(r.ok, false);
  });
});

describe('store.transition — unknown id', () => {
  test('returns ok:false with a clear error', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const r = store.transition({ id: 'DOES_NOT_EXIST', target: 'actioned', stage: 'forge:write', cycle: 'c' });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/lib/feedback-store.test.js`
Expected: tests referencing `store.transition` and `store.writeDeadlockedSnapshot` fail with `TypeError: store.transition is not a function`.

---

## Task 1.8: Feedback store — state transitions (GREEN)

**Files:** Extend `scripts/lib/feedback-store.js`.

- [ ] **Step 1: Add `transition` and `writeDeadlockedSnapshot` methods**

Inside the returned object in `openFeedbackStore`, add the following methods (insert before the closing `};`):

```js
    transition({ id, target, stage, cycle, reason }) {
      const item = items.find(x => x.id === id);
      if (!item) return { ok: false, error: `feedback item not found: ${id}` };

      const stageBase = stage.split(':')[0];
      const sourceMatches = stage === item.source;
      const current = item.history[0].state;

      // A2 (REVISION-CONTRACT §A2 / spec §5.1 rule 7): forge may only produce
      // wont-fix for items whose source base is 'appraise'. Enforced before
      // the matrix check so the error points at the real reason.
      if (stageBase === 'forge' && target === 'wont-fix') {
        if (!canForgeWontFix(item, stageBase)) {
          return {
            ok: false,
            error: `forge may only mark wont-fix on feedback whose source is appraise; ` +
                   `this item's source is ${item.source}`,
          };
        }
      }

      // A3 (REVISION-CONTRACT §A3 / spec §5.1 rule 5): human-appraise has
      // universal authority over non-resolved items, independent of source.
      // Bypass sourceMatches gating in the matrix for this caller base.
      const effectiveSourceMatches =
        stageBase === 'human-appraise' ? true : sourceMatches;

      const check = validateTransition({
        currentState: current,
        target,
        stageBase,
        sourceMatches: effectiveSourceMatches,
      });
      if (!check.ok) return { ok: false, error: check.reason };

      // Reason requirements per spec §4.3 (updated per REVISION-CONTRACT §A1):
      // required on {rejected, wont-fix, deadlocked, resolved}; forbidden on open;
      // optional on actioned. Deadlocked is only written by writeDeadlockedSnapshot;
      // here we validate the 'target' state.
      const REASON_REQUIRED_TARGETS = new Set(['rejected', 'wont-fix', 'resolved']);
      if (REASON_REQUIRED_TARGETS.has(target) && (!reason || !reason.trim())) {
        return { ok: false, error: `reason is required for transition → ${target}` };
      }
      // 'open' is forbidden as a transition target (state machine rejects it
      // upstream), so no 'reason forbidden on open' branch is needed here.

      const snapshot = { state: target, stage, cycle, timestamp: nowIso() };
      if (reason && reason.trim()) snapshot.reason = reason;

      item.history = [snapshot, ...item.history];
      persist();
      return { ok: true };
    },

    // Sort-only. Writes deadlocked snapshots atomically in a single pass.
    // Not validated through validateTransition (sort bypasses the state machine
    // per spec §6.1).
    writeDeadlockedSnapshot({ id, cycle, reason }) {
      const item = items.find(x => x.id === id);
      if (!item) return { ok: false, error: `feedback item not found: ${id}` };
      if (!reason) return { ok: false, error: 'reason is required for deadlocked snapshot' };
      const snapshot = {
        state: 'deadlocked',
        stage: 'sort',
        cycle,
        timestamp: nowIso(),
        reason,
      };
      item.history = [snapshot, ...item.history];
      persist();
      return { ok: true };
    },
```

- [ ] **Step 2: Run tests and confirm pass**

Run: `node --test tests/lib/feedback-store.test.js`
Expected: all tests pass.

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/feedback-store.js tests/lib/feedback-store.test.js
git commit -m "feat(feedback-store): state transitions, deadlock override, sort snapshot

Adds store.transition() which enforces the spec §5 transition matrix
via validateTransition and requires reasons on rejected/wont-fix plus
every deadlock-override transition. Adds store.writeDeadlockedSnapshot
as the sort-only writer of state=deadlocked; sort bypasses the normal
state machine per spec §6.1."
```

---

## Task 1.8.5: `writeDeadlockedSnapshots` batch primitive (RED → GREEN)

**Files:** Extend `tests/lib/feedback-store.test.js` and `scripts/lib/feedback-store.js`.

Per REVISION-CONTRACT §B1: phase 4's sort pass deadlocks N items atomically in a single file rewrite. This batch primitive lives in phase 1 so phase 4 does not have to loop the singular writer. Either all N snapshots land, or none.

- [ ] **Step 1: Write the failing tests (RED)**

Append this block to `tests/lib/feedback-store.test.js`:

```js
describe('store.writeDeadlockedSnapshots — batch atomic primitive (B1)', () => {
  test('writes snapshots for N items with a single atomic rename', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const a = store.add({ file: 'a.md', tag: 'law:x', text: 'ta', source: 'appraise:a', cycle: 'c' });
    const b = store.add({ file: 'b.md', tag: 'law:y', text: 'tb', source: 'appraise:a', cycle: 'c' });
    const c = store.add({ file: 'c.md', tag: 'law:z', text: 'tc', source: 'appraise:a', cycle: 'c' });

    // Count io.rename invocations for the duration of the batch call.
    let renameCount = 0;
    const realRename = io.rename;
    io.rename = (from, to) => { renameCount += 1; return realRename(from, to); };

    const res = store.writeDeadlockedSnapshots(
      [a.id, b.id, c.id],
      'depth=3',
      'sort',
      'c',
    );
    assert.equal(res.ok, true);
    assert.equal(renameCount, 1, 'batch must persist via exactly one atomic rename');

    // All three items now have history[0].state === 'deadlocked'.
    for (const id of [a.id, b.id, c.id]) {
      const item = store.get(id);
      assert.equal(item.history[0].state, 'deadlocked');
      assert.equal(item.history[0].stage, 'sort');
      assert.equal(item.history[0].reason, 'depth=3');
    }
  });

  test('mid-write crash (rename throws) leaves all N items unchanged', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const a = store.add({ file: 'a.md', tag: 'law:x', text: 'ta', source: 'appraise:a', cycle: 'c' });
    const b = store.add({ file: 'b.md', tag: 'law:y', text: 'tb', source: 'appraise:a', cycle: 'c' });
    const c = store.add({ file: 'c.md', tag: 'law:z', text: 'tc', source: 'appraise:a', cycle: 'c' });

    const beforeFile = io._files['WORK.feedback.yaml'];
    const beforeHistoryLengths = [a.id, b.id, c.id].map(id => store.get(id).history.length);

    // Sabotage rename for the next call.
    const realRename = io.rename;
    io.rename = () => { throw new Error('simulated rename failure'); };

    assert.throws(
      () => store.writeDeadlockedSnapshots([a.id, b.id, c.id], 'depth=3', 'sort', 'c'),
      /simulated rename failure/,
    );

    // On-disk bytes untouched.
    assert.equal(io._files['WORK.feedback.yaml'], beforeFile);

    // In-memory view untouched: no item gained a deadlocked snapshot.
    io.rename = realRename;
    for (let i = 0; i < 3; i++) {
      const id = [a.id, b.id, c.id][i];
      assert.equal(store.get(id).history.length, beforeHistoryLengths[i]);
      assert.notEqual(store.get(id).history[0].state, 'deadlocked');
    }
    // Store invariant: no partial batch visible.
    assert.equal(
      store.list().filter(it => it.history[0].state === 'deadlocked').length,
      0,
      'no item may be deadlocked when the batch failed',
    );
  });

  test('empty array is a no-op — no file touched, no rename', () => {
    const io = mockIO({ 'WORK.feedback.yaml': yaml.dump({ items: [] }) });
    const before = io._files['WORK.feedback.yaml'];
    let renameCount = 0;
    const realRename = io.rename;
    io.rename = (from, to) => { renameCount += 1; return realRename(from, to); };
    let writeCount = 0;
    const realWrite = io.writeFile;
    io.writeFile = (p, c) => { writeCount += 1; return realWrite(p, c); };

    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const res = store.writeDeadlockedSnapshots([], 'depth=3', 'sort', 'c');
    assert.equal(res.ok, true);
    assert.equal(renameCount, 0, 'empty batch writes nothing');
    assert.equal(writeCount, 0, 'empty batch writes nothing');
    assert.equal(io._files['WORK.feedback.yaml'], before);
  });
});
```

- [ ] **Step 2: Run and confirm failure for the right reason**

Run: `node --test tests/lib/feedback-store.test.js`
Expected: FAIL with `TypeError: store.writeDeadlockedSnapshots is not a function`. This is the RED reason — the batch method does not yet exist.

- [ ] **Step 3: Implement the batch primitive (GREEN)**

Inside the object returned by `openFeedbackStore` in `scripts/lib/feedback-store.js`, add the following method (next to `writeDeadlockedSnapshot`):

```js
    /**
     * Batch deadlock writer. Used by sort (phase 4) to persist `state=deadlocked`
     * snapshots for N items in a single atomic rename. Either all snapshots
     * land or none. Bypasses validateTransition — sort owns deadlock per §6.1.
     *
     * @param {string[]} ids — feedback item ids to deadlock.
     * @param {string} reason — required; same reason applied to all snapshots.
     * @param {string} stage — caller stage, typically 'sort'.
     * @param {string} cycle — current cycle id.
     */
    writeDeadlockedSnapshots(ids, reason, stage, cycle) {
      if (!Array.isArray(ids)) return { ok: false, error: 'ids must be an array' };
      if (ids.length === 0) return { ok: true };
      if (!reason) return { ok: false, error: 'reason is required for deadlocked snapshot' };

      // Build nextItems entirely in memory before any IO.
      const ts = nowIso();
      const idSet = new Set(ids);
      const missing = [];
      const nextItems = items.map(it => {
        if (!idSet.has(it.id)) return it;
        const snap = { state: 'deadlocked', stage, cycle, timestamp: ts, reason };
        return { ...it, history: [snap, ...it.history] };
      });
      for (const id of ids) {
        if (!items.some(it => it.id === id)) missing.push(id);
      }
      if (missing.length) {
        return { ok: false, error: `feedback item(s) not found: ${missing.join(',')}` };
      }

      // Single atomic persist. If saveItems throws, in-memory `items` stays
      // unchanged (we only assign after save succeeds).
      saveItems(path, nextItems, io);
      items = nextItems;
      return { ok: true };
    },
```

- [ ] **Step 4: Run tests and confirm pass**

Run: `node --test tests/lib/feedback-store.test.js`
Expected: all three new batch tests pass; existing tests still green.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/feedback-store.js tests/lib/feedback-store.test.js
git commit -m 'feat(feedback-store): writeDeadlockedSnapshots batch primitive

Phase 4 sort needs to deadlock N items in a single atomic rewrite. This
batch method builds the new items array in memory, persists once via
saveItems (one writeFile + one rename), and only swaps the in-memory
view after the rename succeeds. Either all N snapshots land or none.

Implements REVISION-CONTRACT §B1.'
```

---

## Task 1.9: Feedback store — dedup edge cases + source validation (RED)

**Files:** Extend `tests/lib/feedback-store.test.js`.

This task covers two invariants. The dedup edge cases codify §8.3 (resolved items unblock re-addition; deadlocked items do not). The `source` validation is a new behaviour not yet present in the task 1.6 implementation — it provides the **genuine RED** step for this task (task 1.6's `add` accepts any non-empty `source` string; this task tightens it to `base:alias` format).

- [ ] **Step 1: Add dedup + source-validation tests**

```js
describe('store.add — dedup semantics', () => {
  test('same (file, tag, text) returns existing id and does not write a new item', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const first = store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    const second = store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    assert.equal(second.deduped, true);
    assert.equal(second.id, first.id);
    assert.equal(store.list().length, 1);
  });

  test('different file breaks dedup', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    const r = store.add({ file: 'b.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    assert.equal(r.deduped, false);
    assert.equal(store.list().length, 2);
  });

  test('different tag breaks dedup', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    const r = store.add({ file: 'a.md', tag: 'law:y', text: 'same', source: 'appraise:a', cycle: 'c' });
    assert.equal(r.deduped, false);
    assert.equal(store.list().length, 2);
  });

  test('resolved items do not block re-addition (regression feedback)', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const a = store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    store.transition({ id: a.id, target: 'actioned', stage: 'forge:w', cycle: 'c' });
    store.transition({ id: a.id, target: 'resolved', stage: 'appraise:a', cycle: 'c', reason: 'ok' });
    const b = store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    assert.equal(b.deduped, false);
    assert.notEqual(b.id, a.id);
    assert.equal(store.list().length, 2);
  });

  test('deadlocked items DO block dedup (they are non-resolved)', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    const a = store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    store.writeDeadlockedSnapshot({ id: a.id, cycle: 'c', reason: 'depth=3' });
    const b = store.add({ file: 'a.md', tag: 'law:x', text: 'same', source: 'appraise:a', cycle: 'c' });
    assert.equal(b.deduped, true);
    assert.equal(b.id, a.id);
  });
});

describe('store.add — source format validation (RED target)', () => {
  // Per spec §4.2: source is `base:alias`. Task 1.6's implementation accepts
  // any non-empty string. These tests force the implementation to validate
  // the format; they are the RED step for task 1.10.

  test('rejects source without a colon', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.throws(
      () => store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise', cycle: 'c' }),
      /source must be in 'base:alias' form/,
    );
  });

  test('rejects source with empty alias', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.throws(
      () => store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:', cycle: 'c' }),
      /source must be in 'base:alias' form/,
    );
  });

  test('rejects source with empty base', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.throws(
      () => store.add({ file: 'a.md', tag: 'law:x', text: 't', source: ':alias', cycle: 'c' }),
      /source must be in 'base:alias' form/,
    );
  });

  test('rejects source with unknown base', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.throws(
      () => store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'sort:main', cycle: 'c' }),
      /unknown source base/,
    );
  });

  test('accepts all valid source bases', () => {
    const io = mockIO();
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    for (const base of ['forge', 'quench', 'appraise', 'human-appraise']) {
      const r = store.add({ file: `${base}.md`, tag: 'law:x', text: 't', source: `${base}:alias`, cycle: 'c' });
      assert.equal(typeof r.id, 'string');
    }
  });
});
```

- [ ] **Step 2: Run and confirm failure for the right reason**

Run: `node --test tests/lib/feedback-store.test.js`
Expected: the `store.add — source format validation` block **FAILS**. Each test expects `store.add` to throw, but task 1.6's implementation accepts any non-empty `source` string, so the call returns an id instead of throwing. Example failure:

```
AssertionError: Missing expected exception (/source must be in 'base:alias' form/).
```

The dedup tests in the first block should pass (they match the implementation in task 1.6). This is the RED signal for task 1.10: the source-validation behaviour is not yet implemented.

---

## Task 1.10: Feedback store — dedup edge cases + source validation (GREEN + commit)

- [ ] **Step 1: Implement the `source` format validator in `store.add`**

In `scripts/lib/feedback-store.js`, at the top of the `add` method (before the existing required-field check), insert:

```js
      const VALID_SOURCE_BASES = new Set(['forge', 'quench', 'appraise', 'human-appraise']);

      if (typeof source !== 'string' || !source.includes(':')) {
        throw new Error(`source must be in 'base:alias' form; got ${JSON.stringify(source)}`);
      }
      {
        const [base, ...aliasParts] = source.split(':');
        const alias = aliasParts.join(':');
        if (!base || !alias) {
          throw new Error(`source must be in 'base:alias' form; got ${JSON.stringify(source)}`);
        }
        if (!VALID_SOURCE_BASES.has(base)) {
          throw new Error(`unknown source base: ${base} (expected one of: forge, quench, appraise, human-appraise)`);
        }
      }
```

If any of the dedup tests also failed in task 1.9, re-read the tests and fix the dedup logic. The task 1.6 implementation filters on `currentState(it) !== 'resolved'` which matches the spec §8.3 invariant; no change expected.

- [ ] **Step 2: Run tests and confirm pass**

Run: `node --test tests/lib/feedback-store.test.js`
Expected: all tests pass — dedup block stays green, source-format block flips to green.

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
git add tests/lib/feedback-store.test.js scripts/lib/feedback-store.js
git commit -m 'test(feedback-store): lock in dedup edge cases; validate source format

Resolved items do not block re-addition (legitimate regression feedback);
deadlocked items DO block dedup (they remain non-resolved). Matches the
source-of-truth invariant in spec §8.3.

Also tightens store.add to reject source values that are not in the
base:alias form (spec §4.2) or whose base is not one of the four known
stage bases. Downstream code that splits source on ":" now has a
statically enforced contract.'
```

---

## Task 1.11: Feedback store — atomic rename (RED)

**Files:** Extend `tests/lib/feedback-store.test.js`.

- [ ] **Step 1: Add atomicity tests**

```js
describe('store.add — atomicity', () => {
  test('rename failure leaves the live file unchanged AND in-memory list unchanged', () => {
    const io = mockIO({ 'WORK.feedback.yaml': yaml.dump({ items: [] }) });
    const originalContent = io._files['WORK.feedback.yaml'];
    // Override rename to throw on the next call.
    const realRename = io.rename;
    io.rename = () => { throw new Error('simulated rename failure'); };
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.throws(
      () => store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' }),
      /simulated rename failure/
    );
    // Live file is untouched.
    assert.equal(io._files['WORK.feedback.yaml'], originalContent);
    // REVISION-CONTRACT §C1 M2: in-memory state must also roll back.
    // Without this assertion, a naive `items.push(item); persist();` passes
    // the file-unchanged check but leaves the store inconsistent with disk.
    assert.strictEqual(store.list().length, 0, 'in-memory list must roll back on persist failure');
    // Restore for cleanup.
    io.rename = realRename;
  });

  test('writeFile failure leaves the live file unchanged AND in-memory list unchanged', () => {
    const io = mockIO({ 'WORK.feedback.yaml': yaml.dump({ items: [] }) });
    const originalContent = io._files['WORK.feedback.yaml'];
    io.writeFile = () => { throw new Error('simulated writeFile failure'); };
    const store = openFeedbackStore('WORK.feedback.yaml', io);
    assert.throws(
      () => store.add({ file: 'a.md', tag: 'law:x', text: 't', source: 'appraise:a', cycle: 'c' }),
      /simulated writeFile failure/
    );
    assert.equal(io._files['WORK.feedback.yaml'], originalContent);
    assert.strictEqual(store.list().length, 0, 'in-memory list must roll back on persist failure');
  });
});
```

- [ ] **Step 2: Run and confirm failure for the right reason**

Run: `node --test tests/lib/feedback-store.test.js`

Expected: the `store.list().length === 0` assertion in both tests **FAILS** against the task 1.6 implementation, which uses `items.push(item); persist();`. When `persist()` throws (rename or writeFile), the item has already been pushed into the in-memory `items` array, so `store.list()` returns a list of length 1. This is the RED signal — the atomicity guarantee must extend to in-memory state, not only on-disk bytes.

Example failure:

```
AssertionError: in-memory list must roll back on persist failure
  actual: 1
  expected: 0
```

- [ ] **Step 3: Refactor `add` (and `transition`, `writeDeadlockedSnapshot`) to build-then-swap (GREEN)**

Replace the in-place mutation pattern with build-next-then-swap so the in-memory array only flips after `saveItems` returns successfully.

In `scripts/lib/feedback-store.js`, update `add`:

```js
      // OLD: items.push(item); persist();
      const nextItems = [...items, item];
      saveItems(path, nextItems, io);
      items = nextItems;
```

Apply the same pattern to `transition`:

```js
      // OLD: item.history = [snapshot, ...item.history]; persist();
      const nextItems = items.map(it =>
        it.id === id ? { ...it, history: [snapshot, ...it.history] } : it
      );
      saveItems(path, nextItems, io);
      items = nextItems;
```

And to `writeDeadlockedSnapshot` (singular):

```js
      // OLD: item.history = [snapshot, ...item.history]; persist();
      const nextItems = items.map(it =>
        it.id === id ? { ...it, history: [snapshot, ...it.history] } : it
      );
      saveItems(path, nextItems, io);
      items = nextItems;
```

`writeDeadlockedSnapshots` (batch, task 1.8.5) already uses the build-then-swap pattern and does not need to change.

The `persist()` helper and direct `items.push`/`item.history = …` assignments can be removed from these methods; `saveItems(path, nextItems, io)` is the single write path.

- [ ] **Step 4: Run tests and confirm pass**

Run: `node --test tests/lib/feedback-store.test.js`
Expected: all atomicity tests pass, including the new `store.list().length === 0` assertions; all other tests still green.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/feedback-store.js tests/lib/feedback-store.test.js
git commit -m 'test(feedback-store): atomicity under rename/writeFile failure

Verifies that an exception on io.writeFile or io.rename leaves the live
WORK.feedback.yaml untouched AND the in-memory store view unchanged.
Production code flips items to nextItems only after saveItems returns
successfully (build-then-swap), so a mid-write crash can never produce
a store state inconsistent with disk.

Implements REVISION-CONTRACT §C1 M2.'
```

---

## Task 1.12: Phase 1 verification gate

- [ ] **Step 1: Run full suite**

```bash
npm test
```
Expected: all previously-green tests still green; new test count increase matches:
- `tests/lib/ulid.test.js` — 6 tests
- `tests/lib/feedback-transitions.test.js` — ~22 tests (17 matrix + 5 `canForgeWontFix`)
- `tests/lib/feedback-store.test.js` — ~30 tests (load, add, transition, human-appraise override, deadlock, dedup, source validation, atomicity, batch deadlock)

- [ ] **Step 2: Grep for leaked production code that imports the new modules**

```bash
rg -n "from.*feedback-store|from.*ulid" scripts/ .opencode/ tests/
```
Expected: matches **only** in `tests/lib/feedback-store.test.js`, `tests/lib/ulid.test.js`, `tests/lib/feedback-transitions.test.js`, and `scripts/lib/feedback-store.js` itself (importing ulid + feedback-transitions). If any production module imports `feedback-store.js`, you got ahead of the plan — phase 3 wires up the plugin, phase 4 wires up sort/orchestrate. Revert.

- [ ] **Step 3: Confirm no in-flight legacy shim breakage**

```bash
rg -n "validateTransition\(" scripts/ .opencode/
```
Expected: two call sites — `scripts/lib/feedback.js` (legacy shim inserted in task 1.4) and `scripts/lib/feedback-store.js` (new). No others.

- [ ] **Step 4: Handoff**

Phase 1 complete. No more commits in this phase. Inform the operator:

> "Phase 1 complete. Added ulid, feedback-store, rewrote feedback-transitions with a six-state matrix. Legacy `scripts/lib/feedback.js` gets a one-line shim at line 256 that phase 4 removes. Full suite green. Ready for phase 2."
