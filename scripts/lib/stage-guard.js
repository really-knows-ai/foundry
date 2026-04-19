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

export function requireActiveStage(io, { stageBase, cycle } = {}) {
  const a = readActiveStage(io);
  if (!a) return { ok: false, error: `tool requires active stage; current: none` };
  if (stageBase && stageBaseOf(a.stage) !== stageBase) {
    return { ok: false, error: `tool requires active ${stageBase} stage; current: ${a.stage}` };
  }
  if (cycle && a.cycle !== cycle) {
    return { ok: false, error: `tool requires active stage in cycle ${cycle}; current cycle: ${a.cycle}` };
  }
  return { ok: true, active: a };
}
