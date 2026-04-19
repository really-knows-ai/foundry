# Phase 1 — Infrastructure

> Pure-function helpers with full unit test coverage. No plugin wiring yet. All helpers are consumed by Phase 2+.

**Prereqs:** none. Start here.

**Test command for this phase:** `node --test tests/lib/`

---

## Task 1: `scripts/lib/state.js` — active-stage state file

**Files:**
- Create: `scripts/lib/state.js`
- Create: `tests/lib/state.test.js`

**Responsibility:** Read/write `.foundry/active-stage.json` and `.foundry/last-stage.json`. Ensure `.foundry/` dir exists. Takes an `io` dependency so tests can stub (matching `scripts/lib/history.js` pattern).

- [ ] **Step 1: Write the failing test**

```js
// tests/lib/state.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import {
  ensureFoundryDir, readActiveStage, writeActiveStage, clearActiveStage,
  readLastStage, writeLastStage,
} from '../../scripts/lib/state.js';

function makeRealIO(dir) {
  const r = (p) => join(dir, p);
  return {
    exists: (p) => existsSync(r(p)),
    readFile: (p) => readFileSync(r(p), 'utf-8'),
    writeFile: (p, c) => { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(r(p), c, 'utf-8'); },
    readDir: (p) => readdirSync(r(p)),
    mkdir: (p) => mkdirSync(r(p), { recursive: true }),
  };
}

describe('state.js', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'foundry-state-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('ensureFoundryDir is idempotent', () => {
    const io = makeRealIO(dir);
    ensureFoundryDir(io);
    ensureFoundryDir(io);
    assert.ok(io.exists('.foundry'));
  });

  it('readActiveStage returns null when absent', () => {
    const io = makeRealIO(dir);
    assert.equal(readActiveStage(io), null);
  });

  it('writeActiveStage then readActiveStage round-trips', () => {
    const io = makeRealIO(dir);
    const payload = { cycle: 'c', stage: 'forge:c', tokenHash: 'abc', baseSha: 'deadbeef', startedAt: '2026-04-19T00:00:00Z' };
    writeActiveStage(io, payload);
    assert.deepEqual(readActiveStage(io), payload);
  });

  it('clearActiveStage makes readActiveStage null', () => {
    const io = makeRealIO(dir);
    writeActiveStage(io, { cycle: 'c', stage: 's', tokenHash: 't', baseSha: 'b', startedAt: 'x' });
    clearActiveStage(io);
    assert.equal(readActiveStage(io), null);
  });

  it('last-stage round-trip independent of active-stage', () => {
    const io = makeRealIO(dir);
    writeLastStage(io, { cycle: 'c', stage: 'forge:c', baseSha: 'bb' });
    assert.equal(readLastStage(io).baseSha, 'bb');
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `node --test tests/lib/state.test.js`
Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Implement**

```js
// scripts/lib/state.js
const ACTIVE = '.foundry/active-stage.json';
const LAST = '.foundry/last-stage.json';
const DIR = '.foundry';

export function ensureFoundryDir(io) {
  if (!io.exists(DIR)) io.mkdir(DIR);
}

export function readActiveStage(io) {
  if (!io.exists(ACTIVE)) return null;
  return JSON.parse(io.readFile(ACTIVE));
}

export function writeActiveStage(io, payload) {
  ensureFoundryDir(io);
  io.writeFile(ACTIVE, JSON.stringify(payload, null, 2));
}

export function clearActiveStage(io) {
  if (io.exists(ACTIVE)) io.unlink?.(ACTIVE) ?? io.writeFile(ACTIVE, ''); // see note
  // NOTE: extend makeIO with an `unlink`; see Task 1b.
}

export function readLastStage(io) {
  if (!io.exists(LAST)) return null;
  return JSON.parse(io.readFile(LAST));
}

export function writeLastStage(io, payload) {
  ensureFoundryDir(io);
  io.writeFile(LAST, JSON.stringify(payload, null, 2));
}
```

- [ ] **Step 4: Extend `makeIO` in `.opencode/plugins/foundry.js` with `unlink` + `mkdir`**

Modify `.opencode/plugins/foundry.js:111-119`:

```js
function makeIO(directory) {
  const resolve = (p) => path.isAbsolute(p) ? p : path.join(directory, p);
  return {
    exists: (p) => existsSync(resolve(p)),
    readFile: (p) => readFileSync(resolve(p), 'utf-8'),
    writeFile: (p, content) => writeFileSync(resolve(p), content, 'utf-8'),
    readDir: (p) => readdirSync(resolve(p)),
    mkdir: (p) => mkdirSync(resolve(p), { recursive: true }),
    unlink: (p) => { if (existsSync(resolve(p))) unlinkSync(resolve(p)); },
  };
}
```

And at the top of the file, add `unlinkSync, mkdirSync` to the existing `node:fs` import.

- [ ] **Step 5: Replace the fallback in `clearActiveStage`**

```js
export function clearActiveStage(io) {
  io.unlink(ACTIVE);
}
```

- [ ] **Step 6: Run the test — expect PASS**

`node --test tests/lib/state.test.js`

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/state.js tests/lib/state.test.js .opencode/plugins/foundry.js
git commit -m "feat(harden): add state.js for active-stage tracking"
```

---

## Task 2: `scripts/lib/secret.js` — HMAC secret

**Files:**
- Create: `scripts/lib/secret.js`
- Create: `tests/lib/secret.test.js`

**Responsibility:** Generate 32-byte random secret at `.foundry/.secret` if absent, return it; ensure mode 0600. Idempotent.

- [ ] **Step 1: Write the test**

```js
// tests/lib/secret.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOrCreateSecret } from '../../scripts/lib/secret.js';

describe('secret.js', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'foundry-secret-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('creates a 32-byte secret on first call', () => {
    const s = readOrCreateSecret(dir);
    assert.equal(s.length, 32);
  });

  it('is idempotent — second call returns same bytes', () => {
    const a = readOrCreateSecret(dir);
    const b = readOrCreateSecret(dir);
    assert.deepEqual(a, b);
  });

  it('file is mode 0600', () => {
    readOrCreateSecret(dir);
    const mode = statSync(join(dir, '.foundry/.secret')).mode & 0o777;
    assert.equal(mode, 0o600);
  });
});
```

- [ ] **Step 2: Run — expect fail.** `node --test tests/lib/secret.test.js`

- [ ] **Step 3: Implement**

```js
// scripts/lib/secret.js
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export function readOrCreateSecret(directory) {
  const dir = join(directory, '.foundry');
  const file = join(dir, '.secret');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (existsSync(file)) return readFileSync(file);
  const bytes = randomBytes(32);
  writeFileSync(file, bytes);
  chmodSync(file, 0o600);
  return bytes;
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/secret.js tests/lib/secret.test.js
git commit -m "feat(harden): add secret.js for per-worktree HMAC key"
```

---

## Task 3: `scripts/lib/token.js` — HMAC token envelope

**Files:**
- Create: `scripts/lib/token.js`
- Create: `tests/lib/token.test.js`

**Responsibility:** `signToken(payload, secret)` returns `base64url(payload).base64url(hmac)`. `verifyToken(token, secret)` returns `{ok: true, payload}` or `{ok: false, reason}`. Reasons: `malformed`, `bad_signature`, `expired`.

- [ ] **Step 1: Write the test**

```js
// tests/lib/token.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../../scripts/lib/token.js';

const SECRET = Buffer.alloc(32, 7);

describe('token.js', () => {
  it('signs and verifies a fresh token', () => {
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n1', exp: Date.now() + 60_000 };
    const t = signToken(payload, SECRET);
    const r = verifyToken(t, SECRET);
    assert.equal(r.ok, true);
    assert.deepEqual(r.payload, payload);
  });

  it('rejects tampered payload', () => {
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n1', exp: Date.now() + 60_000 };
    const t = signToken(payload, SECRET);
    const [p, s] = t.split('.');
    const tampered = Buffer.from(JSON.stringify({ ...payload, route: 'forge:other' })).toString('base64url') + '.' + s;
    assert.equal(verifyToken(tampered, SECRET).ok, false);
    assert.equal(verifyToken(tampered, SECRET).reason, 'bad_signature');
  });

  it('rejects expired token', () => {
    const payload = { route: 'forge:c', cycle: 'c', nonce: 'n1', exp: Date.now() - 1 };
    const r = verifyToken(signToken(payload, SECRET), SECRET);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'expired');
  });

  it('rejects malformed token', () => {
    assert.equal(verifyToken('not-a-token', SECRET).reason, 'malformed');
    assert.equal(verifyToken('onlyonesegment', SECRET).reason, 'malformed');
  });

  it('rejects with wrong secret', () => {
    const payload = { route: 'r', cycle: 'c', nonce: 'n', exp: Date.now() + 60_000 };
    const t = signToken(payload, SECRET);
    assert.equal(verifyToken(t, Buffer.alloc(32, 9)).reason, 'bad_signature');
  });
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement**

```js
// scripts/lib/token.js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'malformed' };
  const [body, mac] = token.split('.');
  if (!body || !mac) return { ok: false, reason: 'malformed' };
  const expected = createHmac('sha256', secret).update(body).digest();
  let given;
  try { given = Buffer.from(mac, 'base64url'); } catch { return { ok: false, reason: 'malformed' }; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); }
  catch { return { ok: false, reason: 'malformed' }; }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/token.js tests/lib/token.test.js
git commit -m "feat(harden): add token.js for HMAC-signed dispatch tokens"
```

---

## Task 4: `scripts/lib/feedback-transitions.js` — state-machine matrix

**Files:**
- Create: `scripts/lib/feedback-transitions.js`
- Create: `tests/lib/feedback-transitions.test.js`

**Responsibility:** Pure `validateTransition(current, target, stageBase)` returning `{ok: true}` or `{ok: false, reason}`. Plus `hashText(text)` → 16-hex-char sha256.

- [ ] **Step 1: Write the test — cover every cell of the matrix in HARDEN.md §4**

```js
// tests/lib/feedback-transitions.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateTransition, hashText } from '../../scripts/lib/feedback-transitions.js';

describe('validateTransition', () => {
  // forge transitions
  it('forge: open → actioned', () => assert.ok(validateTransition('open', 'actioned', 'forge').ok));
  it('forge: open → wont-fix', () => assert.ok(validateTransition('open', 'wont-fix', 'forge').ok));
  it('forge: rejected → actioned', () => assert.ok(validateTransition('rejected', 'actioned', 'forge').ok));
  it('forge: rejected → wont-fix', () => assert.ok(validateTransition('rejected', 'wont-fix', 'forge').ok));
  it('forge: cannot approve', () => assert.equal(validateTransition('actioned', 'approved', 'forge').ok, false));

  // quench transitions
  it('quench: actioned → approved', () => assert.ok(validateTransition('actioned', 'approved', 'quench').ok));
  it('quench: actioned → rejected', () => assert.ok(validateTransition('actioned', 'rejected', 'quench').ok));
  it('quench: wont-fix → approved REJECTED (quench cannot)', () =>
    assert.equal(validateTransition('wont-fix', 'approved', 'quench').ok, false));
  it('quench: wont-fix → rejected REJECTED', () =>
    assert.equal(validateTransition('wont-fix', 'rejected', 'quench').ok, false));

  // appraise transitions
  it('appraise: actioned → approved', () => assert.ok(validateTransition('actioned', 'approved', 'appraise').ok));
  it('appraise: wont-fix → approved', () => assert.ok(validateTransition('wont-fix', 'approved', 'appraise').ok));
  it('appraise: wont-fix → rejected', () => assert.ok(validateTransition('wont-fix', 'rejected', 'appraise').ok));

  // human-appraise transitions
  it('human-appraise: wont-fix → approved', () =>
    assert.ok(validateTransition('wont-fix', 'approved', 'human-appraise').ok));

  // terminal
  it('approved is terminal', () => {
    assert.equal(validateTransition('approved', 'rejected', 'quench').ok, false);
    assert.equal(validateTransition('approved', 'actioned', 'forge').ok, false);
  });

  // reverse direction
  it('cannot un-action', () => assert.equal(validateTransition('actioned', 'open', 'forge').ok, false));
});

describe('hashText', () => {
  it('is 16 hex chars', () => assert.match(hashText('hi'), /^[0-9a-f]{16}$/));
  it('is deterministic', () => assert.equal(hashText('x'), hashText('x')));
  it('differs for different input', () => assert.notEqual(hashText('a'), hashText('b')));
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement**

```js
// scripts/lib/feedback-transitions.js
import { createHash } from 'node:crypto';

// Matrix: [current][target] => set of allowed stageBases (null = any stage)
const MATRIX = {
  open:       { actioned: ['forge'], 'wont-fix': ['forge'] },
  actioned:   { approved: ['quench', 'appraise', 'human-appraise'], rejected: ['quench', 'appraise', 'human-appraise'] },
  'wont-fix': { approved: ['appraise', 'human-appraise'], rejected: ['appraise', 'human-appraise'] },
  rejected:   { actioned: ['forge'], 'wont-fix': ['forge'] },
  approved:   {}, // terminal
};

export function validateTransition(current, target, stageBase) {
  const row = MATRIX[current];
  if (!row) return { ok: false, reason: `unknown state: ${current}` };
  const allowedStages = row[target];
  if (!allowedStages) return { ok: false, reason: `invalid transition ${current} → ${target}` };
  if (!allowedStages.includes(stageBase)) {
    return { ok: false, reason: `stage ${stageBase} cannot transition ${current} → ${target}` };
  }
  return { ok: true };
}

export function hashText(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/feedback-transitions.js tests/lib/feedback-transitions.test.js
git commit -m "feat(harden): add feedback-transitions.js state machine"
```

---

## Task 4.5: Normalize `max-iterations` key (Bug F cherry-pick)

**Files:**
- Modify: `scripts/lib/workfile.js` (all call sites that read/write the key)
- Modify: `tests/lib/workfile.test.js`

**Responsibility:** Canonical on-disk form is `max-iterations` (kebab, matches YAML idiom). Tolerate `maxIterations` on read by rewriting it. `foundry_workfile_set` accepts either form but writes kebab.

- [ ] **Step 1: Inspect current code**

Read `scripts/lib/workfile.js` end-to-end and `tests/lib/workfile.test.js` to see how the field is currently written (the `parseFrontmatter` / `setFrontmatterField` functions).

- [ ] **Step 2: Add failing tests**

```js
// Append to tests/lib/workfile.test.js
it('parseFrontmatter normalizes maxIterations to max-iterations', () => {
  const md = '---\nmaxIterations: 5\n---\n# Goal\n';
  const fm = parseFrontmatter(md);
  assert.equal(fm['max-iterations'], 5);
  assert.equal(fm.maxIterations, undefined);
});

it('setFrontmatterField writes kebab even when given camel', () => {
  const input = '---\ncycle: c\n---\n# Goal\n';
  const out = setFrontmatterField(input, 'maxIterations', 3);
  assert.match(out, /max-iterations: 3/);
  assert.doesNotMatch(out, /maxIterations/);
});
```

- [ ] **Step 3: Run — expect fail.**

- [ ] **Step 4: Implement**

In `parseFrontmatter`, after parsing, add:

```js
if (fm.maxIterations !== undefined && fm['max-iterations'] === undefined) {
  fm['max-iterations'] = fm.maxIterations;
  delete fm.maxIterations;
}
```

In `setFrontmatterField`, at entry:

```js
if (key === 'maxIterations') key = 'max-iterations';
```

Update `foundry_workfile_create` in `.opencode/plugins/foundry.js:178-207` — if it writes `maxIterations`, change to `max-iterations`. Check for `maxIterations:` string literal in that file and swap. Update the `foundry_workfile_create` tool's `args.maxIterations` parameter name to remain (public API) but map to kebab internally.

Also update `scripts/sort.js` — grep for `maxIterations` / `max-iterations` and make the deadlock calculation read `fm['max-iterations'] ?? fm.maxIterations`.

- [ ] **Step 5: Run ALL lib tests and sort test — expect PASS**

```bash
node --test tests/lib/workfile.test.js tests/sort.test.js
```

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/workfile.js scripts/sort.js .opencode/plugins/foundry.js tests/lib/workfile.test.js
git commit -m "fix(harden): normalize maxIterations → max-iterations (Bug F)"
```

---

## Task 4.6: `scripts/lib/pending.js` — in-memory pending-nonce store

**Files:**
- Create: `scripts/lib/pending.js`
- Create: `tests/lib/pending.test.js`

**Responsibility:** `createPendingStore()` returns `{add(nonce, meta), consume(nonce), size()}`. `consume` is single-use (removes + returns), returns `null` if unknown/expired. Expired entries auto-pruned on consume.

- [ ] **Step 1: Test**

```js
// tests/lib/pending.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPendingStore } from '../../scripts/lib/pending.js';

describe('pending store', () => {
  it('add then consume returns meta', () => {
    const s = createPendingStore();
    s.add('n1', { route: 'r', cycle: 'c', exp: Date.now() + 1000 });
    assert.deepEqual(s.consume('n1').route, 'r');
  });

  it('second consume returns null', () => {
    const s = createPendingStore();
    s.add('n1', { route: 'r', cycle: 'c', exp: Date.now() + 1000 });
    s.consume('n1');
    assert.equal(s.consume('n1'), null);
  });

  it('unknown nonce returns null', () => {
    assert.equal(createPendingStore().consume('x'), null);
  });

  it('expired nonce returns null and is evicted', () => {
    const s = createPendingStore();
    s.add('old', { route: 'r', cycle: 'c', exp: Date.now() - 1 });
    assert.equal(s.consume('old'), null);
    assert.equal(s.size(), 0);
  });
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement**

```js
// scripts/lib/pending.js
export function createPendingStore() {
  const map = new Map();
  return {
    add(nonce, meta) { map.set(nonce, meta); },
    consume(nonce) {
      const meta = map.get(nonce);
      if (!meta) return null;
      map.delete(nonce);
      if (meta.exp < Date.now()) return null;
      return meta;
    },
    size() {
      // prune expired for accurate size
      const now = Date.now();
      for (const [k, v] of map) if (v.exp < now) map.delete(k);
      return map.size;
    },
  };
}
```

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pending.js tests/lib/pending.test.js
git commit -m "feat(harden): add pending.js for single-use dispatch nonces"
```

---

## Task 4.7: `scripts/lib/stage-guard.js` — precondition helpers

**Files:**
- Create: `scripts/lib/stage-guard.js`
- Create: `tests/lib/stage-guard.test.js`

**Responsibility:** Factor the precondition check into one place. Returns `{ok: true}` or `{ok: false, error: "<message>"}` — caller serializes and returns.

- [ ] **Step 1: Test**

```js
// tests/lib/stage-guard.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requireNoActiveStage, requireActiveStage, stageBaseOf } from '../../scripts/lib/stage-guard.js';

function fakeIO(active) {
  const store = new Map();
  if (active) store.set('.foundry/active-stage.json', JSON.stringify(active));
  return {
    exists: (p) => store.has(p),
    readFile: (p) => store.get(p),
  };
}

describe('stage-guard', () => {
  it('requireNoActiveStage ok when absent', () => {
    assert.equal(requireNoActiveStage(fakeIO(null)).ok, true);
  });

  it('requireNoActiveStage errors when present', () => {
    const r = requireNoActiveStage(fakeIO({ cycle: 'c', stage: 'forge:c' }));
    assert.equal(r.ok, false);
    assert.match(r.error, /no active stage.*forge:c/);
  });

  it('requireActiveStage matches stageBase + cycle', () => {
    const io = fakeIO({ cycle: 'c', stage: 'forge:c' });
    assert.ok(requireActiveStage(io, { stageBase: 'forge', cycle: 'c' }).ok);
  });

  it('requireActiveStage rejects stageBase mismatch', () => {
    const io = fakeIO({ cycle: 'c', stage: 'forge:c' });
    const r = requireActiveStage(io, { stageBase: 'quench', cycle: 'c' });
    assert.equal(r.ok, false);
    assert.match(r.error, /requires active quench stage/);
  });

  it('stageBaseOf splits on colon', () => {
    assert.equal(stageBaseOf('forge:create-haiku'), 'forge');
    assert.equal(stageBaseOf('human-appraise:x'), 'human-appraise');
  });
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement**

```js
// scripts/lib/stage-guard.js
import { readActiveStage } from './state.js';

export function stageBaseOf(stage) {
  const i = stage.indexOf(':');
  return i === -1 ? stage : stage.slice(0, i);
}

export function requireNoActiveStage(io) {
  const a = readActiveStage(io);
  if (!a) return { ok: true };
  return { ok: false, error: `tool requires no active stage; current: ${a.stage}` };
}

export function requireActiveStage(io, { stageBase, cycle } = {}) {
  const a = readActiveStage(io);
  if (!a) return { ok: false, error: `tool requires active stage; current: none` };
  if (stageBase && stageBaseOf(a.stage) !== stageBase) {
    return { ok: false, error: `tool requires active ${stageBase} stage; current: ${a.stage}` };
  }
  if (cycle && a.cycle !== cycle) {
    return { ok: false, error: `tool requires active stage in cycle ${cycle}; current cycle: ${a.cycle}` };
  }
  return { ok: true, active: a };
}
```

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/stage-guard.js tests/lib/stage-guard.test.js
git commit -m "feat(harden): add stage-guard.js precondition helpers"
```

---

## Phase 1 complete

Run: `node --test tests/lib/` — everything should pass before proceeding to [PHASE_2.md](PHASE_2.md).
