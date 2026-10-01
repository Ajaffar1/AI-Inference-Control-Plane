import { randomUUID } from 'node:crypto';

const nonnegative = (n, label) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError(`${label} must be a nonnegative safe integer`);
  return n;
};
const required = (v, label) => {
  if (typeof v !== 'string' || !v.trim() || v.length > 200) throw new TypeError(`${label} must be a nonempty string up to 200 characters`);
  return v;
};

/** Rates are integer USD microdollars per million tokens. Decimal cost uses BigInt. */
export function priceUsage(usage, rates) {
  const input = nonnegative(usage.inputTokens, 'inputTokens');
  const cached = nonnegative(usage.cachedInputTokens ?? 0, 'cachedInputTokens');
  const output = nonnegative(usage.outputTokens, 'outputTokens');
  if (cached > input) throw new TypeError('Cached input cannot exceed total input');
  if (!rates) return { status: 'unknown', usd: null, nanoUsd: null };
  required(rates.version, 'rate version');
  for (const key of ['input', 'cachedInput', 'output']) nonnegative(rates[key], key);
  // Round to nearest nanodollar once, after all dimensions are summed.
  const numerator = BigInt(input - cached) * BigInt(rates.input)
    + BigInt(cached) * BigInt(rates.cachedInput) + BigInt(output) * BigInt(rates.output);
  const nano = (numerator + 500n) / 1000n;
  return { status: 'priced', nanoUsd: nano.toString(), usd: Number(nano) / 1e9, rateVersion: rates.version };
}

export function validateEvent(event) {
  for (const key of ['id', 'executionId', 'project', 'task', 'provider', 'model']) required(event[key], key);
  if (!['completed', 'failed'].includes(event.status)) throw new TypeError('Invalid status');
  if (![null, true, false].includes(event.accepted)) throw new TypeError('Invalid outcome');
  if (!Number.isFinite(event.latencyMs) || event.latencyMs < 0) throw new TypeError('Invalid latency');
  if (!Number.isFinite(Date.parse(event.timestamp))) throw new TypeError('Invalid timestamp');
  const expected = event.usage === null ? {status:'unknown', nanoUsd:null, usd:null} : priceUsage(event.usage, event.rates);
  if (JSON.stringify(expected) !== JSON.stringify(event.cost)) throw new TypeError('Cost does not match usage and rates');
  return event;
}

export function createEvent({ executionId = randomUUID(), project, task, provider, model, usage = null, rates = null, latencyMs = 0, status = 'completed', accepted = null }) {
  return validateEvent({ schemaVersion: 1, id: randomUUID(), executionId, timestamp: new Date().toISOString(), project, task, provider, model, usage, rates, latencyMs, status, accepted, cost: usage === null ? {status:'unknown', nanoUsd:null, usd:null} : priceUsage(usage, rates) });
}

/** Caller supplies a provider call returning {output, usage}; no prompts are retained. */
export function createTracker({ record, clock = () => performance.now() }) {
  return {
    async track(metadata, call) {
      const started = clock();
      let result;
      try { result = await call(); }
      catch (error) {
        const event = createEvent({ ...metadata, status: 'failed', accepted: null, latencyMs: Math.max(0, clock() - started), usage: error.usage ?? null });
        try { await record(event); } catch (recordError) { throw new AggregateError([error, recordError], 'Provider call and telemetry persistence failed'); }
        throw error;
      }
      const event = createEvent({ ...metadata, status: 'completed', accepted: null, latencyMs: Math.max(0, clock() - started), usage: result.usage ?? null });
      // Persistence failure must not look like provider failure or trigger an automatic retry.
      try { await record(event); } catch (cause) {
        const error = new Error('Inference succeeded but telemetry persistence failed', { cause });
        error.output = result.output;
        error.event = event;
        throw error;
      }
      return { output: result.output, event };
    }
  };
}

export function summarize(events) {
  const groups = new Map();
  for (const event of events) {
    validateEvent(event);
    // A logical execution cannot mix attribution or model configurations in this MVP.
    const key = JSON.stringify([event.project, event.task, event.provider, event.model]);
    if (!groups.has(key)) groups.set(key, {project:event.project, task:event.task, provider:event.provider, model:event.model, attempts:0, nano:0n, unpriced:0, executions:new Map(), latencies:[]});
    const g = groups.get(key);
    g.attempts++;
    if (event.cost.nanoUsd === null) g.unpriced++; else g.nano += BigInt(event.cost.nanoUsd);
    g.executions.set(event.executionId, event.accepted);
    g.latencies.push(event.latencyMs);
  }
  return [...groups.values()].map(g => {
    const outcomes = [...g.executions.values()];
    const observed = outcomes.filter(x => x !== null).length;
    const successes = outcomes.filter(x => x === true).length;
    const knownSpend = Number(g.nano) / 1e9;
    const sorted = g.latencies.sort((a,b) => a-b);
    return {project:g.project, task:g.task, provider:g.provider, model:g.model, attempts:g.attempts, executions:outcomes.length, knownSpend, unpriced:g.unpriced, observed, successes, successRate: observed ? successes / observed : null, outcomeCoverage: observed / outcomes.length, costPerSuccess: successes && !g.unpriced && observed === outcomes.length ? knownSpend / successes : null, p95LatencyMs:sorted[Math.ceil(sorted.length * .95)-1]};
  });
}

/** Only compare fully priced, fully evaluated rows within the same task/project. */
export function frontier(rows) {
  const eligible = rows.filter(r => !r.unpriced && r.outcomeCoverage === 1 && r.successRate !== null);
  return eligible.filter(a => !eligible.some(b => b !== a && b.project === a.project && b.task === a.task && b.knownSpend / b.executions <= a.knownSpend / a.executions && b.successRate >= a.successRate && (b.knownSpend / b.executions < a.knownSpend / a.executions || b.successRate > a.successRate)));
}
