const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function isRetryableStatus(statusCode) {
  return statusCode != null && RETRYABLE_STATUS_CODES.has(statusCode);
}

function isRetryableError(error, statusCode) {
  if (isRetryableStatus(statusCode)) return true;
  if (error?.message?.match(/abort|timeout/i)) return true;
  return false;
}

function assertResponseOk(res) {
  if (!res.ok) return res;
  return null;
}

async function parseEmbeddings(body) {
  if (!Array.isArray(body.data)) throw new Error('embeddings provider returned malformed response (no data[])');
  for (const item of body.data) {
    if (!('index' in item)) {
      throw new Error('embedding provider returned data without index field - cannot verify ordering');
    }
  }
  return body.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
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
    const errRes = assertResponseOk(res);
    if (errRes) {
      const text = await res.text().catch(() => '');
      const error = new Error(`embeddings provider returned ${res.status}: ${text.slice(0, 500)}`);
      error.statusCode = res.status;
      throw error;
    }
    const body = await res.json();
    return parseEmbeddings(body);
  } finally {
    clearTimeout(t);
  }
}

function shouldGiveUp(attempt, maxAttempts, error) {
  const isLastAttempt = attempt === maxAttempts - 1;
  if (isLastAttempt) return true;
  if (!isRetryableError(error, error.statusCode)) return true;
  return false;
}

function buildRetryError(error, attempt) {
  return new Error(`${error.message} (after ${attempt} retries)`, { cause: error });
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
      if (shouldGiveUp(attempt, maxAttempts, error)) {
        if (attempt > 0) throw buildRetryError(error, attempt);
        throw error;
      }
      await new Promise((resolve) => { setTimeout(resolve, delays[attempt]); });
    }
  }

  // This should never be reached, but TypeScript/linters like it
  throw lastError;
}

function validateVector(v, dimensions) {
  if (!Array.isArray(v) || v.length !== dimensions) {
    throw new Error(`embedding dimension mismatch: expected ${dimensions}, got ${Array.isArray(v) ? v.length : 'non-array'}`);
  }
  for (const x of v) if (!Number.isFinite(x)) throw new Error('embedding contains non-finite number');
}

export async function embed({ config, inputs }) {
  if (!config.enabled) throw new Error('embeddings are disabled in memory config');
  if (!Array.isArray(inputs) || inputs.length === 0) return [];

  const out = [];
  for (let i = 0; i < inputs.length; i += config.batchSize) {
    const batch = inputs.slice(i, i + config.batchSize);
    const vectors = await callWithRetry({ config, inputs: batch });
    for (const v of vectors) validateVector(v, config.dimensions);
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
