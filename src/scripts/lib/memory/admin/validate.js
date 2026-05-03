import { loadMemoryConfig } from '../config.js';
import { loadSchema } from '../schema.js';
import { loadVocabulary } from '../types.js';
import { detectDrift } from '../drift.js';

export async function validateMemory({ io }) {
  const issues = [];
  try {
    const config = await loadMemoryConfig('foundry', io);
    if (!config.present) issues.push({ kind: 'missing-config', message: 'foundry/memory/config.md missing' });
    const schema = await loadSchema('foundry', io);
    const vocab = await loadVocabulary('foundry', io);
    const drift = detectDrift({ vocabulary: vocab, schema });
    for (const item of drift.items) issues.push(item);
  } catch (err) {
    issues.push({ kind: 'load-error', message: err.message });
  }
  return { ok: issues.length === 0, issues };
}
