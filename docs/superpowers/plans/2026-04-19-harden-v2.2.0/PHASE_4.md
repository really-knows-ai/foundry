# Phase 4 — `foundry_sort` Updates

> Make sort produce dispatch tokens and reject calls while a stage is active. This is what closes the loop: Phase 2 tools accept tokens, Phase 4 issues them.

**Prereqs:** Phases 1–3 complete.

**Test command:** `node --test tests/sort.test.js tests/plugin/sort.test.js`

---

## Task 14: `foundry_sort` generates tokens for dispatchable routes

**Files:**
- Modify: `scripts/sort.js` (add optional `mint` dependency param; unchanged-by-default for existing callers / tests)
- Modify: `.opencode/plugins/foundry.js:414-424` (inject minting)
- Modify: `tests/sort.test.js` (extend for token cases)
- Create: `tests/plugin/sort.test.js` (plugin-level end-to-end)

**Design:** `runSort(args, io)` stays pure. The plugin-level tool wraps it and adds `token`/`model` side-channel effects. Specifically:

```js
// scripts/sort.js
export function runSort({ cycleDef, io, now = Date.now(), mint }) {
  const route = /* existing routing logic */;
  if (isDispatchableRoute(route)) {
    const model = /* existing model-resolution */;
    const token = mint?.({ route, cycle: cycleDef.name, exp: now + 10 * 60 * 1000 });
    return { route, model, ...(token && { token }) };
  }
  return { route }; // done | blocked | violation
}
```

Dispatchable routes are anything matching `/^(forge|quench|appraise|human-appraise):/`.

- [ ] **Step 1: Add sort-level tests**

```js
// Append to tests/sort.test.js
it('returns token when mint fn is provided and route is dispatchable', () => {
  const seen = [];
  const res = runSort({ /* existing setup */, mint: (p) => { seen.push(p); return 'TOKEN'; } });
  assert.equal(res.token, 'TOKEN');
  assert.equal(seen[0].route, res.route);
  assert.ok(seen[0].exp > Date.now());
});

it('does not call mint for non-dispatchable routes', () => {
  const mint = () => { throw new Error('should not be called'); };
  // set up a WORK.md fixture where sort returns {route: 'done'}
  const res = runSort({ /* ... */, mint });
  assert.equal(res.token, undefined);
  assert.equal(res.route, 'done');
});
```

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Implement `mint` threading in `scripts/sort.js`.** Keep `mint` optional so existing tests continue to pass (they don't supply it, and routes without a token are still valid for the CLI use case).

- [ ] **Step 4: Wire mint in the plugin**

Modify `foundry_sort` in `.opencode/plugins/foundry.js:414-424`:

```js
foundry_sort: tool({
  description: 'Determine the next stage for the current cycle and (if dispatchable) mint a single-use token.',
  args: { cycleDef: tool.schema.string().optional() },
  async execute(args, context) {
    const io = makeIO(context.worktree);
    // Precondition (Task 15): no active stage.
    const guard = requireNoActiveStage(io);
    if (!guard.ok) return JSON.stringify({ error: guard.error });

    const mint = ({ route, cycle, exp }) => {
      const nonce = randomUUID();
      const payload = { route, cycle, nonce, exp };
      pending.add(nonce, payload);
      return signToken(payload, secret);
    };
    const result = runSort({ cycleDef: args.cycleDef, io, cwd: context.worktree, mint });
    return JSON.stringify(result);
  },
}),
```

- [ ] **Step 5: Plugin-level test `tests/plugin/sort.test.js`**

```js
it('plugin sort returns token for dispatchable route', async () => {
  // Prepare a temp repo with foundry/cycles/c.md + WORK.md that causes sort to route to forge:c
  // Call plugin.tool.foundry_sort.execute(...)
  // Assert result.token is a string, and pending store size is 1.
  // Consume the token via stage_begin, assert it works end-to-end.
});

it('plugin sort does not return token for route=done', async () => {
  // Fixture where sort returns done; assert no token, no pending entry.
});
```

- [ ] **Step 6: Pass.**

- [ ] **Step 7: Commit**

```bash
git add scripts/sort.js .opencode/plugins/foundry.js tests/sort.test.js tests/plugin/sort.test.js
git commit -m "feat(harden): foundry_sort mints HMAC dispatch tokens"
```

---

## Task 15: `foundry_sort` rejects when a stage is active

Already implemented as part of Task 14 Step 4 (the `requireNoActiveStage` guard). Task 15 just adds the explicit rejection test.

- [ ] **Step 1: Test**

```js
// tests/plugin/sort.test.js
it('foundry_sort errors when active-stage.json exists', async () => {
  // seed .foundry/active-stage.json manually, call sort, expect error.
  mkdirSync(join(dir, '.foundry'), { recursive: true });
  writeFileSync(join(dir, '.foundry/active-stage.json'), JSON.stringify({ cycle: 'c', stage: 'forge:c' }));
  const res = JSON.parse(await plugin.tool.foundry_sort.execute({}, { worktree: dir }));
  assert.match(res.error, /no active stage/);
});
```

- [ ] **Step 2: Run — should already pass** (guard was added in Task 14).

- [ ] **Step 3: Commit** (tiny)

```bash
git add tests/plugin/sort.test.js
git commit -m "test(harden): sort rejects while stage active"
```

---

## Phase 4 complete

Full cycle now verifiable end-to-end in tests: `sort` → `stage_begin` → (subagent work) → `stage_end` → `stage_finalize`. Run `node --test tests/` to confirm green. Proceed to [PHASE_5.md](PHASE_5.md).
