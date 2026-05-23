// scripts/lib/feedback-store.js
import yaml from 'js-yaml';
import { ulid } from './ulid.js';
import { validateTransition, hashText, canForgeWontFix } from './feedback-transitions.js';

const YAML_OPTS = { lineWidth: -1 };

const VALID_SOURCE_BASES = new Set(['forge', 'quench', 'appraise', 'human-appraise']);

function validateSourceBase(base) {
  if (!VALID_SOURCE_BASES.has(base)) {
    throw new Error(`unknown source base: ${base} (expected one of: forge, quench, appraise, human-appraise)`);
  }
}

function validateSourceFormat(source) {
  if (typeof source !== 'string' || !source.includes(':')) {
    throw new Error(`source must be in 'base:alias' form; got ${JSON.stringify(source)}`);
  }
  const [base, ...aliasParts] = source.split(':');
  const alias = aliasParts.join(':');
  if (!base || !alias) {
    throw new Error(`source must be in 'base:alias' form; got ${JSON.stringify(source)}`);
  }
  validateSourceBase(base);
}

function parseYamlDoc(raw) {
  const doc = yaml.load(raw);
  if (doc === null) return null;
  if (!Array.isArray(doc.items)) {
    throw new Error(`WORK.feedback.yaml malformed: top-level must be an object with an 'items' array`);
  }
  return doc.items;
}

function loadItems(path, io) {
  if (!io.exists(path)) return [];
  const raw = io.readFile(path);
  if (!raw || !raw.trim()) return [];
  return parseYamlDoc(raw) || [];
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

function currentState(item) {
  return item.history[0].state;
}

function cloneItem(it) {
  return { ...it, history: it.history.map(h => ({ ...h })) };
}

function resolveSystemItemsImpl({ items, stage, cycle, timestamp, persist }) {
  const snapshot = { state: 'resolved', stage, cycle, timestamp: timestamp() };
  const next = items.map(it =>
    it.tag === 'system:missing-tool-calls' && it.history[0].state !== 'resolved'
      ? { ...it, history: [snapshot, ...it.history] }
      : it
  );
  persist(next);
}

export function openFeedbackStore(path, io) {
  let items = loadItems(path, io);
  function persist(nextItems) {
    saveItems(path, nextItems, io);
    items = nextItems;
  }
  return {
    list() { return items.map(cloneItem); },
    get(id) {
      const it = items.find(x => x.id === id);
      return it ? cloneItem(it) : null;
    },
    add(params) {
      return storeAdd(params, items, {
        hashFn: hashText, stateOf: currentState,
        validateSrc: validateSourceFormat, persist,
        makeUlid: ulid, timestamp: nowIso,
      });
    },
    transition(params) {
      return storeTransition(params, items, {
        validateTransitionFn: validateTransition,
        canForgeWontFixFn: canForgeWontFix,
        timestamp: nowIso, persist,
      });
    },
    writeDeadlockedSnapshotForTest(params) {
      return storeWriteDeadlockedSnapshot(params, items, { timestamp: nowIso, persist });
    },
    writeDeadlockedSnapshots(ids, reason, stage, cycle) {
      return storeWriteDeadlockedSnapshots({ ids, reason, stage, cycle }, items, { timestamp: nowIso, persist });
    },
    resolveSystemItems(stage, cycle) {
      resolveSystemItemsImpl({ items, stage, cycle, timestamp: nowIso, persist });
    },
  };
}

function isDuplicate(item, file, tag, textHash, stateOf) {
  return item.file === file &&
    item.tag === tag &&
    hashText(item.text) === textHash &&
    stateOf(item) !== 'resolved';
}

function assertAddParams(...params) {
  for (const p of params) {
    if (!p) throw new Error('add requires file, tag, text, source, cycle');
  }
}

function storeAdd(params, items, deps) {
  const { file, tag, text, source, cycle } = params;
  const { hashFn, stateOf, validateSrc, persist, makeUlid, timestamp } = deps;
  assertAddParams(file, tag, text, source, cycle);
  validateSrc(source);

  const textHash = hashFn(text);
  const existing = items.find(it => isDuplicate(it, file, tag, textHash, stateOf));
  if (existing) return { id: existing.id, deduped: true };

  const id = makeUlid();
  const item = {
    id, file, tag, text, source,
    history: [{ state: 'open', stage: source, cycle, timestamp: timestamp() }],
  };
  persist([...items, item]);
  return { id, deduped: false };
}

function forgeWontFixAllowed(item, stageBase, target, canForgeWontFixFn) {
  if (stageBase !== 'forge') return true;
  if (target !== 'wont-fix') return true;
  return canForgeWontFixFn(item, stageBase);
}

function forgeWontFixError(item) {
  return `forge may only mark wont-fix on feedback whose source is ` +
    `appraise; this item's source is ${item.source}`;
}

function reasonRequiredForTransition(target, current, reason) {
  const REASON_REQUIRED_TARGETS = new Set(['rejected', 'wont-fix']);
  return (REASON_REQUIRED_TARGETS.has(target) || current === 'deadlocked')
    && (!reason || !reason.trim());
}

function sourceMatchesStage(stageBase, stage, itemSource) {
  return stageBase === 'human-appraise' || stage === itemSource;
}

function validateTransitionInput(item, ctx, fns) {
  if (!forgeWontFixAllowed(item, ctx.stageBase, ctx.target, fns.canForgeWontFixFn)) {
    return forgeWontFixError(item);
  }
  const current = item.history[0].state;
  const check = fns.validateTransitionFn({
    currentState: current, target: ctx.target, stageBase: ctx.stageBase,
    sourceMatches: sourceMatchesStage(ctx.stageBase, ctx.stage, item.source),
  });
  if (!check.ok) return check.reason;
  if (reasonRequiredForTransition(ctx.target, current, ctx.reason)) {
    return `reason is required for transition → ${ctx.target}`;
  }
  return null;
}

function hasNonEmptyReason(reason) {
  return Boolean(reason && reason.trim());
}

function applyTransition(items, id, snapshot) {
  return items.map(it =>
    it.id === id ? { ...it, history: [snapshot, ...it.history] } : it
  );
}

function storeTransition(params, items, deps) {
  const { id, target, stage, cycle, reason } = params;
  const { validateTransitionFn, canForgeWontFixFn, timestamp, persist } = deps;

  const item = items.find(x => x.id === id);
  if (!item) return { ok: false, error: `feedback item not found: ${id}` };

  const stageBase = stage.split(':')[0];
  const error = validateTransitionInput(item,
    { stageBase, stage, target, reason },
    { canForgeWontFixFn, validateTransitionFn },
  );
  if (error) return { ok: false, error };

  const snapshot = { state: target, stage, cycle, timestamp: timestamp() };
  if (hasNonEmptyReason(reason)) snapshot.reason = reason;

  persist(applyTransition(items, id, snapshot));
  return { ok: true };
}

function storeWriteDeadlockedSnapshot(params, items, deps) {
  const { id, cycle, reason } = params;
  const { timestamp, persist } = deps;

  const item = items.find(x => x.id === id);
  if (!item) return { ok: false, error: `feedback item not found: ${id}` };
  if (!reason || !reason.trim()) {
    return { ok: false, error: 'reason is required for deadlocked snapshot' };
  }

  const snapshot = { state: 'deadlocked', stage: 'sort', cycle, timestamp: timestamp(), reason };
  persist(items.map(it =>
    it.id === id ? { ...it, history: [snapshot, ...it.history] } : it
  ));
  return { ok: true };
}

function assertDeadlockedSnapshotArgs(ids, reason) {
  if (!Array.isArray(ids)) return { ok: false, error: 'ids must be an array' };
  if (ids.length === 0) return { ok: true };
  if (!reason) return { ok: false, error: 'reason is required for deadlocked snapshot' };
  return null;
}

function storeWriteDeadlockedSnapshots(params, items, deps) {
  const { ids, reason, stage, cycle } = params;
  const { timestamp, persist } = deps;

  const precheck = assertDeadlockedSnapshotArgs(ids, reason);
  if (precheck) return precheck;

  const ts = timestamp();
  const idSet = new Set(ids);
  const nextItems = items.map(it => {
    if (!idSet.has(it.id)) return it;
    return { ...it, history: [{ state: 'deadlocked', stage, cycle, timestamp: ts, reason }, ...it.history] };
  });
  for (const id of ids) {
    if (!items.some(it => it.id === id)) {
      return { ok: false, error: `feedback item(s) not found: ${id}` };
    }
  }

  persist(nextItems);
  return { ok: true };
}
