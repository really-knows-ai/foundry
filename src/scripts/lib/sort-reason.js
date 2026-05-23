import { baseStage } from './sort-routing.js';

const REASON_HANDLERS = {
  forge: forgeReason,
  assay: (d) => `starting cycle — routing to assay`,
  quench: () => 'routing to quench for deterministic validation',
  appraise: appraiseReason,
  'human-appraise': humanAppraiseReason,
  done: () => 'all stages complete — no unresolved feedback',
  blocked: blockedReason,
};

export function reasonForRoute(route, prep) {
  const data = buildReasonData(route, prep);
  const handler = REASON_HANDLERS[data.base] || defaultReason;
  return handler(data);
}

function buildReasonData(route, prep) {
  const base = baseStage(route);
  const forgeCount = prep.history.filter(e => baseStage(e.stage || '') === 'forge').length;
  const maxIt = prep.defaults.maxIterations;
  const feedback = prep.feedback || [];
  const openCount = feedback.filter(
    f => f.state !== 'resolved' && f.state !== 'deadlocked',
  ).length;
  const dlCount = feedback.filter(f => f.state === 'deadlocked').length;
  const needingForge = feedback.filter(
    f => f.state === 'open' || f.state === 'rejected',
  ).length;

  return { base, route, forgeCount, maxIt, openCount, dlCount, needingForge, anyDeadlocked: prep.anyDeadlocked };
}

function forgeReason(d) {
  if (d.forgeCount === 0) return `starting cycle — routing to forge (iteration 1 of ${d.maxIt})`;
  return `found ${d.needingForge} unresolved feedback item(s) — routing to forge for revision (iteration ${d.forgeCount + 1} of ${d.maxIt})`;
}

function appraiseReason(d) {
  if (d.anyDeadlocked) return `${d.dlCount} feedback item(s) deadlocked — routing to appraise for re-evaluation`;
  return `quench passed with ${d.openCount} open feedback item(s) — routing to appraise`;
}

function humanAppraiseReason(d) {
  return `${d.dlCount} feedback item(s) deadlocked after ${d.forgeCount} forge iteration(s) — routing to human for override`;
}

function blockedReason(d) {
  return `max iterations (${d.maxIt}) reached after ${d.forgeCount} forge iteration(s) with ${d.openCount} unresolved feedback item(s)`;
}

function defaultReason(d) {
  return `routing to ${d.route}`;
}
