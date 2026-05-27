// scripts/lib/feedback-store.js
import yaml from 'js-yaml';
import { ulid } from './ulid.js';
import { validateTransition, hashText, canForgeWontFix } from './feedback-transitions.js';

const YAML_OPTS = { lineWidth: -1 };

const VALID_SOURCE_BASES = new Set(['forge', 'quench', 'appraise', 'human-appraise', 'system']);

function validateSourceBase(base) {
  if (!VALID_SOURCE_BASES.has(base)) {
    throw new Error(`unknown source base: ${base} (expected one of: forge, quench, appraise, human-appraise, system)`);
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
    autoResolve({ id, reason, cycle }) {
      return storeAutoResolve({ id, reason, cycle, items, persist, timestamp: nowIso });
    },
    forceState(id, state, cycle, stage) {
      return storeForceState({ id, state, cycle, items, persist, stage });
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

function assertAddParams(file, tag, text, source, cycle) {
  const missing = typeof file !== 'string' || [tag, text, source, cycle].some(v => !v);
  if (missing) throw new Error('add requires file, tag, text, source, cycle');
}

function storeAdd(params, items, deps) {
  const { file, tag, text, source, cycle, artefact_version } = params;
  const { hashFn, stateOf, validateSrc, persist, makeUlid, timestamp } = deps;
  assertAddParams(file, tag, text, source, cycle);
  validateSrc(source);

  const textHash = hashFn(text);
  const existing = items.find(it =>
    it.artefact_version === artefact_version && isDuplicate(it, file, tag, textHash, stateOf)
  );
  if (existing) return { id: existing.id, deduped: true };

  const id = makeUlid();
  const item = {
    id, file, tag, text, source,
    history: [{ state: 'open', stage: source, cycle, timestamp: timestamp() }],
  };
  if (artefact_version !== undefined) {
    item.artefact_version = artefact_version;
  }
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
  return REASON_REQUIRED_TARGETS.has(target)
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

function storeForceState({ id, state, cycle, items, persist, stage }) {
  const item = items.find(x => x.id === id);
  if (!item) return { ok: false, error: `feedback item not found: ${id}` };
  const snapshot = { state, stage: stage || 'system:forge-contract-mismatch', cycle, timestamp: nowIso() };
  persist(applyTransition(items, id, snapshot));
  return { ok: true };
}

function storeAutoResolve({ id, reason, cycle, items, persist, timestamp }) {
  const item = items.find(x => x.id === id);
  if (!item) return { ok: false, error: `feedback item not found: ${id}` };
  const snapshot = { state: 'resolved', stage: 'system', cycle, reason, timestamp: timestamp() };
  persist(applyTransition(items, id, snapshot));
  return { ok: true };
}


