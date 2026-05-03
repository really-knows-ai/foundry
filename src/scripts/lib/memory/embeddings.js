function isRetryableError(error, statusCode) {
  // Retry on transient server errors, rate limits, and timeout/abort errors
  if (statusCode && [429, 500, 502, 503, 504].includes(statusCode)) return true;
  if (error?.message?.match(/abort|timeout/i)) return true;
  return false;
}

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
      const error = new Error(`embeddings provider returned ${res.status}: ${text.slice(0, 500)}`);
      error.statusCode = res.status;
      throw error;
    }
    const body = await res.json();
    if (!Array.isArray(body.data)) throw new Error('embeddings provider returned malformed response (no data[])');
    // Validate that all embeddings have an index field to prevent silent misalignment
    for (const item of body.data) {
      if (!('index' in item)) {
        throw new Error('embedding provider returned data without index field - cannot verify ordering');
      }
    }
    return body.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  } finally {
    clearTimeout(t);
  }
}

async function callWithRetry({ config, inputs }) {
  const maxAttempts = 3;
  const delays = [1000, 2000]; // 1s, 2s backoff
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await callOnce({ config, inputs });
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === maxAttempts - 1;
      
      if (isLastAttempt || !isRetryableError(error, error.statusCode)) {
        // Throw immediately if this is the last attempt or error is not retryable
        if (isLastAttempt && attempt > 0) {
          // Add retry context to the error message
          const retriesAttempted = attempt; // attempt is 0-indexed, so attempt=2 means 2 retries
          throw new Error(`${error.message} (after ${retriesAttempted} retries)`);
        }
        throw error;
      }

      // Wait before retrying (only if not the last attempt and error is retryable)
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }

  // This should never be reached, but TypeScript/linters like it
  throw lastError;
}

export async function embed({ config, inputs }) {
  if (!config.enabled) throw new Error('embeddings are disabled in memory config');
  if (!Array.isArray(inputs) || inputs.length === 0) return [];

  const out = [];
  for (let i = 0; i < inputs.length; i += config.batchSize) {
    const batch = inputs.slice(i, i + config.batchSize);
    const vectors = await callWithRetry({ config, inputs: batch });
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
