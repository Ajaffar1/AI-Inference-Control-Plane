/** Pure planning functions. Outputs are estimates, never observed savings. */
export function simulateCascade({requests, cheapCost, strongCost, escalationRate, gateCost = 0}) {
  for (const [name,value] of Object.entries({requests,cheapCost,strongCost,escalationRate,gateCost})) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be finite and nonnegative`);
  }
  if (!Number.isSafeInteger(requests) || escalationRate > 1) throw new TypeError('Invalid request count or escalation rate');
  const baseline = requests * strongCost;
  const escalations = requests * escalationRate;
  const proposed = requests * (cheapCost + gateCost) + escalations * strongCost;
  return {baseline,proposed,escalations,savings:baseline-proposed,savingsRate:baseline ? (baseline-proposed)/baseline : null};
}
export function selectConfiguration(rows,{qualityTarget,maxLatencyMs,maxCost}) {
  if (![qualityTarget,maxLatencyMs,maxCost].every(Number.isFinite) || qualityTarget < 0 || qualityTarget > 1 || maxLatencyMs < 0 || maxCost < 0) throw new TypeError('Invalid routing constraints');
  return rows.filter(r=>!r.unpriced && r.outcomeCoverage===1 && r.successRate!==null && r.successRate>=qualityTarget && r.p95LatencyMs<=maxLatencyMs && r.knownSpend/r.executions<=maxCost).sort((a,b)=>a.knownSpend/a.executions-b.knownSpend/b.executions)[0]??null;
}
export function forecastBudget({spend,elapsedDays,totalDays,budget}) {
  if (![spend,elapsedDays,totalDays,budget].every(Number.isFinite) || spend<0 || budget<0 || elapsedDays<=0 || totalDays<elapsedDays) throw new TypeError('Invalid forecast inputs');
  const forecast=spend/elapsedDays*totalDays;
  return {forecast,remaining:budget-spend,overrun:Math.max(0,forecast-budget),utilization:budget?spend/budget:null};
}
