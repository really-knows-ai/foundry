import { entRelName, edgeRelName } from './cozo.js';
import { validateEntityWrite, validateEdgeWrite } from './validate.js';

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
function lit(s) { return `"${esc(s)}"`; }
function vecLit(v) {
  return `vec([${v.map((n) => Number(n).toString()).join(', ')}])`;
}

export async function putEntity(store, { type, name, value }, vocabulary, { embedder } = {}) {
  validateEntityWrite({ type, name, value }, vocabulary);
  const rel = entRelName(type);
  if (embedder) {
    const vectors = await embedder([value]);
    const vec = vectors && vectors[0];
    if (!Array.isArray(vec)) throw new Error('embedder did not return a vector');
    await store.db.run(
      `?[name, value, embedding] <- [[${lit(name)}, ${lit(value)}, ${vecLit(vec)}]]\n:put ${rel} { name => value, embedding }`,
    );
  } else {
    await store.db.run(
      `?[name, value] <- [[${lit(name)}, ${lit(value)}]]\n:put ${rel} { name => value }`,
    );
  }
}

export async function relate(store, { edge_type, from_type, from_name, to_type, to_name }, vocabulary) {
  validateEdgeWrite({ edge_type, from_type, from_name, to_type, to_name }, vocabulary);
  const rel = edgeRelName(edge_type);
  await store.db.run(
    `?[from_type, from_name, to_type, to_name] <- [[${lit(from_type)}, ${lit(from_name)}, ${lit(to_type)}, ${lit(to_name)}]]\n:put ${rel} { from_type, from_name, to_type, to_name }`,
  );
}

export async function unrelate(store, { edge_type, from_type, from_name, to_type, to_name }, vocabulary) {
  validateEdgeWrite({ edge_type, from_type, from_name, to_type, to_name }, vocabulary);
  const rel = edgeRelName(edge_type);
  await store.db.run(
    `?[from_type, from_name, to_type, to_name] <- [[${lit(from_type)}, ${lit(from_name)}, ${lit(to_type)}, ${lit(to_name)}]]\n:rm ${rel} { from_type, from_name, to_type, to_name }`,
  );
}
