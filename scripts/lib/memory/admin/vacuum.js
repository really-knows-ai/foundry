export async function vacuumMemory({ store }) {
  try {
    await store.db.run('::compact');
  } catch (err) {
    if (!/unknown system op/i.test(String(err))) throw err;
    // Cozo builds without ::compact silently succeed.
  }
  return { ok: true };
}
