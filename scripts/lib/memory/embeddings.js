async function callOnce({ config, inputs }) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), config.timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const res = await fetch(`${config.baseURL}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: config.model, input: inputs }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`embeddings provider returned ${res.status}: ${text.slice(0, 500)}`);
    }
    const body = await res.json();
    if (!Array.isArray(body.data)) throw new Error('embeddings provider returned malformed response (no data[])');
    return body.data
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((d) => d.embedding);
  } finally {
    clearTimeout(t);
  }
}

export async function embed({ config, inputs }) {
  if (!config.enabled) throw new Error('embeddings are disabled in memory config');
  if (!Array.isArray(inputs) || inputs.length === 0) return [];

  const out = [];
  for (let i = 0; i < inputs.length; i += config.batchSize) {
    const batch = inputs.slice(i, i + config.batchSize);
    const vectors = await callOnce({ config, inputs: batch });
    for (const v of vectors) {
      if (!Array.isArray(v) || v.length !== config.dimensions) {
        throw new Error(`embedding dimension mismatch: expected ${config.dimensions}, got ${Array.isArray(v) ? v.length : 'non-array'}`);
      }
      for (const x of v) if (!Number.isFinite(x)) throw new Error('embedding contains non-finite number');
    }
    out.push(...vectors);
  }
  return out;
}

export async function probeEmbeddings({ config }) {
  try {
    const out = await embed({ config, inputs: ['probe'] });
    return { ok: true, dimensions: out[0].length };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  }
}
