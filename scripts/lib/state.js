const ACTIVE = '.foundry/active-stage.json';
const LAST = '.foundry/last-stage.json';
const DIR = '.foundry';

export function ensureFoundryDir(io) {
  if (!io.exists(DIR)) io.mkdir(DIR);
}

export function readActiveStage(io) {
  if (!io.exists(ACTIVE)) return null;
  return JSON.parse(io.readFile(ACTIVE));
}

export function writeActiveStage(io, payload) {
  ensureFoundryDir(io);
  io.writeFile(ACTIVE, JSON.stringify(payload, null, 2));
}

export function clearActiveStage(io) {
  io.unlink(ACTIVE);
}

export function readLastStage(io) {
  if (!io.exists(LAST)) return null;
  return JSON.parse(io.readFile(LAST));
}

export function writeLastStage(io, payload) {
  ensureFoundryDir(io);
  io.writeFile(LAST, JSON.stringify(payload, null, 2));
}
