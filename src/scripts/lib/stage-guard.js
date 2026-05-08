// scripts/lib/stage-guard.js
import { readActiveStage } from './state.js';

export function stageBaseOf(stage) {
  const i = stage.indexOf(':');
  return i === -1 ? stage : stage.slice(0, i);
}

export function requireNoActiveStage(io) {
  const a = readActiveStage(io);
  if (!a) return { ok: true };
  return { ok: false, error: `tool requires no active stage; current: ${a.stage}` };
}

function stageMismatchError(active, stageBase, cycle) {
  if (stageBase && stageBaseOf(active.stage) !== stageBase) {
    return `tool requires active ${stageBase} stage; current: ${active.stage}`;
  }
  if (cycle && active.cycle !== cycle) {
    return `tool requires active stage in cycle ${cycle}; current cycle: ${active.cycle}`;
  }
  return null;
}

export function requireActiveStage(io, { stageBase, cycle } = {}) {
  const a = readActiveStage(io);
  if (!a) return { ok: false, error: `tool requires active stage; current: none` };
  const mismatch = stageMismatchError(a, stageBase, cycle);
  if (mismatch) return { ok: false, error: mismatch };
  return { ok: true, active: a };
}
