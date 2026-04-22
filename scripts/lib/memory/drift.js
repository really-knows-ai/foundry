import { hashFrontmatter } from './schema.js';

function compareFamily({ family, loaded, recorded }) {
  const items = [];
  const loadedNames = new Set(Object.keys(loaded));
  const recordedNames = new Set(Object.keys(recorded));

  for (const name of loadedNames) {
    if (!recordedNames.has(name)) {
      items.push({
        kind: 'unknown-type',
        typeFamily: family,
        typeName: name,
        message: `${family} type '${name}' exists on disk but is not recorded in schema.json`,
        suggestedSkill: `add-memory-${family}-type`,
      });
      continue;
    }
    const currentHash = hashFrontmatter(loaded[name].frontmatter);
    if (currentHash !== recorded[name].frontmatterHash) {
      items.push({
        kind: 'frontmatter-mismatch',
        typeFamily: family,
        typeName: name,
        message: `${family} type '${name}' frontmatter was modified outside of a skill`,
        suggestedSkill: `rename-memory-${family}-type or drop-memory-${family}-type`,
      });
    }
  }

  for (const name of recordedNames) {
    if (!loadedNames.has(name)) {
      items.push({
        kind: 'missing-file',
        typeFamily: family,
        typeName: name,
        message: `${family} type '${name}' is recorded in schema.json but its file is missing on disk`,
        suggestedSkill: `drop-memory-${family}-type or rename-memory-${family}-type`,
      });
    }
  }

  return items;
}

export function detectDrift({ vocabulary, schema }) {
  const items = [
    ...compareFamily({ family: 'entity', loaded: vocabulary.entities, recorded: schema.entities }),
    ...compareFamily({ family: 'edge', loaded: vocabulary.edges, recorded: schema.edges }),
  ];
  return { hasDrift: items.length > 0, items };
}
