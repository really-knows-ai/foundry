// scripts/lib/feedback-store.js
import yaml from 'js-yaml';
import { ulid } from './ulid.js';
import { validateTransition, hashText, canForgeWontFix } from './feedback-transitions.js';

const YAML_OPTS = { lineWidth: -1 };

const VALID_SOURCE_BASES = new Set(['forge', 'quench', 'appraise', 'human-appraise']);

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
      const nextItems = [...items, item];
      saveItems(path, nextItems, io);
      items = nextItems;
      return { id, deduped: false };
    },

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

      // Reason requirements per spec §4.3 (updated per REVISION-CONTRACT §A1 + G1):
      // - required when target is {rejected, wont-fix}
      // - required when overriding a deadlocked item (current state is 'deadlocked')
      // - transitions target {actioned, resolved} with an optional reason unless this is a deadlock override
      // Deadlocked state is only written by writeDeadlockedSnapshot; here we
      // validate both the 'target' state and the 'current' state.
      const REASON_REQUIRED_TARGETS = new Set(['rejected', 'wont-fix']);
      const isDeadlockOverride = current === 'deadlocked';
      if ((REASON_REQUIRED_TARGETS.has(target) || isDeadlockOverride) && (!reason || !reason.trim())) {
        return { ok: false, error: `reason is required for transition → ${target}` };
      }
      // Reachable transition targets are validated upstream, and this branch
      // enforces the remaining reason requirements for those targets.

      const snapshot = { state: target, stage, cycle, timestamp: nowIso() };
      if (reason && reason.trim()) snapshot.reason = reason;

      const nextItems = items.map(it =>
        it.id === id ? { ...it, history: [snapshot, ...it.history] } : it
      );
      saveItems(path, nextItems, io);
      items = nextItems;
      return { ok: true };
    },

    // Sort-only. Writes deadlocked snapshots atomically in a single pass.
    // Sort bypasses validateTransition per spec §6.1.
    writeDeadlockedSnapshot({ id, cycle, reason }) {
      const item = items.find(x => x.id === id);
      if (!item) return { ok: false, error: `feedback item not found: ${id}` };
      if (!reason || !reason.trim()) return { ok: false, error: 'reason is required for deadlocked snapshot' };
      const snapshot = {
        state: 'deadlocked',
        stage: 'sort',
        cycle,
        timestamp: nowIso(),
        reason,
      };
      const nextItems = items.map(it =>
        it.id === id ? { ...it, history: [snapshot, ...it.history] } : it
      );
      saveItems(path, nextItems, io);
      items = nextItems;
      return { ok: true };
    },

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
  };
}
