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
  const forgeCount = prep.history.filter(e =>
    baseStage(e.stage || '') === 'forge' && e.contract_passed !== false,
  ).length;
  const maxIt = prep.defaults.maxIterations;
  const feedback = prep.feedback || [];
  const openCount = feedback.filter(f => f.state !== 'resolved').length;
  const needingForge = feedback.filter(
    f => f.state === 'open' || f.state === 'rejected',
  ).length;
  const alwaysHumanAppraise = prep.defaults.alwaysHumanAppraise;
  const deadlockHumanAppraise = prep.defaults.deadlockHumanAppraise;

  return { base, route, forgeCount, maxIt, openCount, needingForge, alwaysHumanAppraise, deadlockHumanAppraise };
}

function forgeReason(d) {
  if (d.forgeCount === 0) return `starting cycle — routing to forge (iteration 1 of ${d.maxIt})`;
  return `found ${d.needingForge} unresolved feedback item(s) — routing to forge for revision (iteration ${d.forgeCount + 1} of ${d.maxIt})`;
}

function appraiseReason(d) {
  return `quench passed with ${d.openCount} open feedback item(s) — routing to appraise`;
}

function humanAppraiseReason(d) {
  if (d.alwaysHumanAppraise) {
    return `always-human-appraise enabled — routing to human after ${d.forgeCount} forge iteration(s)`;
  }
  return `max iterations (${d.maxIt}) reached after ${d.forgeCount} forge iteration(s) — routing to human for review`;
}

function blockedReason(d) {
  return `max iterations (${d.maxIt}) reached after ${d.forgeCount} forge iteration(s) with ${d.openCount} unresolved feedback item(s)`;
}

function defaultReason(d) {
  return `routing to ${d.route}`;
}
