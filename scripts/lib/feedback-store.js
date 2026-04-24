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
