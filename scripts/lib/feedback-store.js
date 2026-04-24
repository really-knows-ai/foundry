// scripts/lib/feedback-store.js
import yaml from 'js-yaml';
import { ulid } from './ulid.js';
import { validateTransition, hashText, canForgeWontFix } from './feedback-transitions.js';

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
      if (!reason || !reason.trim()) return { ok: false, error: 'reason is required for deadlocked snapshot' };
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
  };
}
