const LOG_PATH = '.foundry/.forge-tool-calls.jsonl';
const RETRIES_PATH = '.foundry/.forge-tool-retries';

export function initForgeCallLog(io) {
  io.writeFile(LOG_PATH, '');
}

export function writeCall(io, toolName) {
  if (!io.exists(LOG_PATH)) return;
  const entry = JSON.stringify({ tool: toolName, ts: Date.now() }) + '\n';
  const existing = io.readFile(LOG_PATH);
  io.writeFile(LOG_PATH, existing + entry);
}

function addCallFromLine(line, called) {
  try {
    const rec = JSON.parse(line);
    if (rec.tool) called.add(rec.tool);
  } catch { /* skip malformed lines */ }
}

function readCallSet(io) {
  const called = new Set();
  if (!io.exists(LOG_PATH)) return called;
  const content = io.readFile(LOG_PATH);
  for (const line of content.split('\n')) {
    if (line) addCallFromLine(line, called);
  }
  return called;
}

export function verifyAndClearForgeCallLog(io, expected) {
  const called = readCallSet(io);
  const missing = expected.filter(t => !called.has(t));
  io.unlink(LOG_PATH);
  return missing.length ? { ok: false, missing } : { ok: true, missing: [] };
}

export function readForgeRetryCount(io) {
  if (!io.exists(RETRIES_PATH)) return 0;
  try {
    return parseInt(io.readFile(RETRIES_PATH).trim(), 10) || 0;
  } catch {
    return 0;
  }
}

export function incrementForgeRetryCount(io) {
  const count = readForgeRetryCount(io) + 1;
  io.writeFile(RETRIES_PATH, String(count));
  return count;
}

export function resetForgeRetryCount(io) {
  io.unlink(RETRIES_PATH);
}
