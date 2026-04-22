import { entRelName, edgeRelName } from './cozo.js';
import { validateEntityWrite, validateEdgeWrite } from './validate.js';

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
function lit(s) { return `"${esc(s)}"`; }

export async function putEntity(store, { type, name, value }, vocabulary) {
  validateEntityWrite({ type, name, value }, vocabulary);
  const rel = entRelName(type);
  await store.db.run(
    `?[name, value] <- [[${lit(name)}, ${lit(value)}]]\n:put ${rel} { name => value }`,
  );
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
