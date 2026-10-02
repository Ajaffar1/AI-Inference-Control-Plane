# Engineering reference

This reference describes the implemented local toolkit. The larger architecture in `blueprint.md` is a proposal, not a description of deployed infrastructure.

## Design invariants

1. One inference attempt is one economic event. Retries add cost; they do not add successful business units.
2. Unknown usage and prices remain unknown. Incomplete cohorts cannot receive a cost-per-success recommendation.
3. Provider-reported output already includes reasoning where that is the provider's convention. Never sum included reasoning twice.
4. Historical rates are exact, effective-dated matches. No alias guessing. Half-open intervals are `[effectiveFrom, effectiveUntil)`.
5. Benchmark comparisons match task IDs. Configuration averages alone do not establish a paired experiment.
6. A completed provider call and a completed evaluation are distinct states. Grader failure preserves inference cost and leaves outcome unknown.
7. Plans do not modify traffic. Estimated savings are counterfactuals, not ledger entries.

## Modules and contracts

| Module | Export | Purpose |
|---|---|---|
| `src/index.js` | `priceUsage`, `createEvent`, `createTracker`, `summarize`, `frontier` | Attempt telemetry, exact token arithmetic and cohort economics |
| `src/store.js` | `EventStore` | Single-process deduplicated attempt journal and append-only outcome journal |
| `src/benchmark.js` | `runBenchmark`, `manifestHash`, `pairedComparison`, `wilsonInterval` | Bounded experiments and statistical analysis |
| `src/pricing-registry.js` | `createPricingRegistry` | Reviewed effective-dated pricing snapshots and lineage hashes |
| `src/diagnostics.js` | `normalizeOpenAIUsage`, `diagnose` | Explicit usage normalization and telemetry checks |
| `src/simulation.js` | `simulateCascade`, `selectConfiguration`, `forecastBudget` | Pure planning calculations |

## Provider instrumentation

Use your existing OpenAI SDK and wrap its call with `createTracker`. The project does not install the SDK or manage provider credentials. `normalizeOpenAIUsage(response.usage)` supports Responses and Chat Completions token fields. It does not implement streaming accumulation, realtime/audio/image billing, tools, or batch discounts.

```js
import {createTracker} from '../src/index.js';
import {normalizeOpenAIUsage} from '../src/diagnostics.js';

const tracker = createTracker({record: event => store.append(event)});
const result = await tracker.track(metadata, async () => {
  const response = await client.responses.create({model, input});
  return {output: response.output_text, usage: normalizeOpenAIUsage(response.usage)};
});
```

`metadata` supplies project/task/provider/model and reviewed rates. Missing usage yields an unpriced event. Store prompts and outputs outside telemetry if your application requires them. No provider calls are performed by the supplied synthetic examples.

## Pricing provenance

Each registry entry includes provider, exact model, region, deployment, USD currency, version, canonical UTC effective dates, HTTPS source URL, reviewer, review date, and integer microdollar rates per million tokens. `effectiveUntil: null` means open-ended. Entries are cloned at construction, reject overlaps and duplicate versions, and return cloned matches with a SHA-256 registry hash.

The hash proves which snapshot was used; it does not prove that a reviewer or source is truthful. Verified pricing still requires human or automated source review. Registry values are supplied by the user; the project ships no claims about current provider prices. Registry hashes are order-sensitive for the entry array.

Token pricing sums integer products with BigInt and rounds once to nanodollars. `nanoUsd` is the exact serialized amount; `usd` is a display number. Statistical utilities and budget estimators use JavaScript numbers, so they are not settlement ledgers.

## Benchmark protocol

A manifest contains unique tasks and configurations, explicit dataset/prompt/rubric versions, and `estimatedMaxCost` for each configuration. Include model parameters, source/document hashes, provider version, pricing-registry hash and evaluation configuration in a real manifest. Hashing sorts object keys but preserves array order. Use JSON-compatible values only. Never include API credentials.

`runBenchmark` invokes caller-injected `execute` and `evaluate` functions. It returns the manifest, hash, costs, status for every task/configuration, and budget diagnostics. `execute` returns `{output, cost}` or throws an error with optional `cost`; `evaluate` returns a boolean. Outputs are passed to the evaluator but omitted from returned result records. The returned manifest contains whatever inputs you supplied; keep private task content out of public artifacts.

States: `completed`, `execution_failed`, `evaluation_failed`, `budget_skipped`, `cancelled`. Cancellation stops dispatch and passes an AbortSignal to adapters; only adapters can actually cancel a running external call. Grading costs are not included in inference costs; instrument them separately.

Reservations are estimates. Active calls can overrun a spend ceiling, and underestimated calls can exceed it. Unknown execution cost stops future dispatch, while already-running calls finish. The runner is in-memory and does not resume after a crash. A future durable job ledger must persist dispatch intent before issuing provider calls.

## Statistical interpretation

Wilson score intervals provide 95% bounds for observed acceptance under independent binary observations. Repeated versions of the same document, clustered clients or correlated evaluator errors violate that assumption; consider cluster-aware analysis before making deployment claims.

`pairedComparison` intersects unique task IDs and reports exclusions. It resamples matched tasks with replacement, preserving within-task correlation between control and treatment. Cost and acceptance deltas are **treatment minus control**. Negative cost is cheaper; negative acceptance is worse. Default: seed 42, 2,000 bootstrap resamples, percentile 95% intervals. This PR does not implement multiple-comparison correction, sequential testing or noninferiority decisions.

The synthetic benchmark intentionally shows a cheaper treatment losing acceptance. It is a regression example, not a model benchmark. A narrow interval from a tiny, homogeneous dataset is not strong evidence. Hold out representative tasks, predefine quality and latency thresholds, blind reviewers, audit judge disagreement, and rerun relevant distribution shifts.

## Failure and privacy boundaries

HTTP bodies are limited to 64 KiB and decoded after byte accumulation to preserve split UTF-8. Event timestamps are canonical UTC strings. Invalid URLs and records return 400. API data access requires a local bearer token; demo writes are forbidden. This is not multi-tenant authentication.

JSONL records are not encrypted, tamper-evident or transactional across processes. Keep one writer process, private filesystem access and backups. Outcome observations append separately, with latest journal order winning. The store is O(n) per append and report, suitable for evaluation-scale local usage only.

The diagnostic report exposes unknown prices, failed calls, duplicate IDs, retries, cache token ratio and pricing versions. Cache token ratio is a usage ratio, not avoided spend. Diagnostics do not reconcile provider invoices or validate source authenticity.

## Verification

`npm test` checks economics, lineage, bounded concurrency, cancellation, unknown bills, grading failures, statistics, usage normalization, storage and HTTP behavior. `npm run benchmark` writes a synthetic report to ignored `data/benchmark.json`.

Optional UI verification: install Playwright locally, install its Chromium browser, then run `node scripts/screenshots.mjs`. The script renders the real demo, checks routing constraints and request inspection, checks mobile overflow, captures five PNGs, and fails on browser JavaScript errors. Screenshots in the README are synthetic demo captures, not live customer telemetry.
