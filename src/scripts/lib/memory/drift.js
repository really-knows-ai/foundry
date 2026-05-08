import { hashFrontmatter } from './schema.js';

function compareLoadedType({ family, name, loadedEntry, recordedEntry }) {
  const currentHash = hashFrontmatter(loadedEntry.frontmatter);
  if (currentHash !== recordedEntry.frontmatterHash) {
    return {
      kind: 'frontmatter-mismatch',
      typeFamily: family,
      typeName: name,
      message: `${family} type '${name}' frontmatter was modified outside of a skill`,
      suggestedSkills: [`rename-memory-${family}-type`, `drop-memory-${family}-type`],
    };
  }
  return null;
}

function findMissingFiles({ family, loadedNames, recordedNames }) {
  const items = [];
  for (const name of recordedNames) {
    if (!loadedNames.has(name)) {
      items.push({
        kind: 'missing-file',
        typeFamily: family,
        typeName: name,
        message: `${family} type '${name}' is recorded in schema.json but its file is missing on disk`,
        suggestedSkills: [`drop-memory-${family}-type`, `rename-memory-${family}-type`],
      });
    }
  }
  return items;
}

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
        suggestedSkills: [`add-memory-${family}-type`],
      });
      continue;
    }
    const item = compareLoadedType({
      family,
      name,
      loadedEntry: loaded[name],
      recordedEntry: recorded[name],
    });
    if (item) {
      items.push(item);
    }
  }

  items.push(...findMissingFiles({ family, loadedNames, recordedNames }));

  return items;
}

export function detectDrift({ vocabulary, schema }) {
  const items = [
    ...compareFamily({ family: 'entity', loaded: vocabulary.entities, recorded: schema.entities }),
    ...compareFamily({ family: 'edge', loaded: vocabulary.edges, recorded: schema.edges }),
  ];
  return { hasDrift: items.length > 0, items };
}
