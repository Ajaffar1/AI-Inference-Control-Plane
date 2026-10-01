# IEOP — R0/R1 technical blueprint

**Status:** Proposed implementation plan • **Date:** October 1, 2026

## 1. Product contract

IEOP answers: What is the lowest total-cost inference configuration that meets the business outcome, quality threshold, and latency requirement?

The first milestone is a reproducible document/SR&ED benchmark: run the same versioned task set through 3–5 explicitly configured models, record actual usage and pricing provenance, assess outputs against a rubric, and show cost, latency, acceptance, cost per accepted task, and the economic frontier. Provider credentials and an approved, de-identified task set are prerequisites for live runs. This blueprint does not assume either is available.

R0 captures attributable inference attempts and computes auditable cost. R1 adds a spend dashboard, trace inspection, benchmark comparison, and exports. A thin evaluation capability supports the milestone; broad production quality scoring remains R2. Dynamic routing, semantic caching, automated budget enforcement, and chargeback remain later releases.

**Release acceptance:** Every gateway attempt has an owner, task, model, status, usage provenance, and a pricing result or explicit unknown state. Retries cannot disappear from spend. Benchmark runs are replayable. Dashboard totals reconcile to the cost ledger. Quality and benefit estimates show their evidence and uncertainty.

## 2. Architecture and repository

Use a TypeScript monorepo, Node.js LTS, Fastify, PostgreSQL, a PostgreSQL-backed job queue, React, and SQL migrations. Store uploaded documents and benchmark outputs in private S3-compatible object storage. Start with one API service and one worker, without ClickHouse, Kubernetes, or a second event bus.

```text
ieop/
  apps/api/                 gateway, authentication, reporting API
  apps/worker/              reconciliation, benchmark execution, evaluation
  apps/web/                 executive dashboard, traces, benchmark lab
  packages/contracts/      JSON Schema/OpenAPI, generated client types
  packages/providers/      provider adapters and capability registry
  packages/pricing/        decimal arithmetic and rate matching
  packages/economics/      aggregate metrics and frontier calculation
  packages/evaluations/     rubric definitions and grader adapters
  db/migrations/           schema and append-only ledger constraints
  fixtures/                synthetic tasks, usage and invoice fixtures
  tests/integration/       provider stubs, database and streaming tests
  infra/                   local Compose and deployment manifests
  docs/                    architecture decisions, runbooks and API examples
```

Request path: application → authenticated gateway → execution/attempt persisted → provider adapter → usage normalized → cost entries appended → execution finalized. Worker path: pending attempts → usage reconciliation; benchmark jobs → bounded provider calls → evaluations → aggregate results. UI reads reporting APIs, never provider keys.

Deploy API and worker independently, with shared PostgreSQL and private object storage. Use managed secrets, TLS, daily database backups and a tested restore procedure. Initial runtime region must satisfy the organization's data residency requirements; decide it before processing client documents.

## 3. Identity and attribution

An organization is the security boundary. API keys map server-side to organization, application, and allowed projects. Never trust a caller-supplied organization identifier. All foreign-key relationships must enforce the same organization, with row-level security as defense in depth and a restricted application database role.

Required attribution: organization, application, project, workflow, task type. Optional: business unit, client, engagement, feature, pseudonymous user. Invalid mandatory IDs fail before inference. Historical events retain an attribution snapshot so renaming a client does not rewrite history. Taxonomy definitions and success criteria are versioned.

## 4. Relational schema

Use UUID primary keys, UTC timestamptz, bigint token counts, and numeric(24,12) monetary values. Never use floating point for pricing. Keep currency explicit; R0 supports USD only and rejects unsupported currencies rather than silently adding them.

| Table | Main fields and constraints |
|---|---|
| organizations | id, name, reporting_timezone |
| attribution_nodes | id, organization_id, kind, parent_id, name, archived_at; validate hierarchy and organization |
| applications | id, organization_id, name, default_project_id |
| api_keys | id, organization_id, application_id, key_hash, scopes, expires_at, revoked_at; never persist plaintext |
| task_types | id, organization_id, key, taxonomy_version, success_definition, rubric_version |
| executions | id, organization_id, application_id, attribution_snapshot, task_type_id, trace_id, idempotency_key, request_hash, status, created_at, completed_at; unique application/idempotency key |
| inference_attempts | id, execution_id, attempt_number, provider, requested_model, resolved_model, model_version, deployment, region, parameters, status, started_at, first_token_at, completed_at, error_code, provider_request_id; unique execution/attempt number |
| usage_records | id, attempt_id, source, source_reference, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, tool_units, raw_usage, observed_at, usage_version; unique attempt/source reference/version |
| pricing_versions | id, provider, model_match, deployment, region, currency, effective_from, effective_until, source_url, retrieved_at, verified_by, input_basis, reasoning_basis; prohibit ambiguous overlapping intervals |
| pricing_rates | id, pricing_version_id, dimension, unit_size, unit_price, tier_min, tier_max, conditions; versioned rates are immutable |
| cost_entries | id, attempt_id, usage_record_id, pricing_version_id, dimension, quantity, amount, currency, entry_kind, reverses_entry_id, recorded_at; immutable signed ledger |
| business_outcomes | id, execution_id, outcome_definition_version, status, evidence_ref, observed_at, observed_by; unknown/pending/success/failure |
| evaluation_results | id, execution_id, benchmark_item_id, evaluator_type, evaluator_version, rubric_version, score, accepted, citation_accuracy, hallucination_flag, evidence_ref, status, evaluated_at |
| benchmark_datasets | id, organization_id, name, version, manifest_hash, document_refs, approved_at; immutable versions |
| benchmark_items | id, dataset_id, task_type_id, input_ref, reference_ref, rubric_version, split, difficulty |
| benchmark_runs | id, dataset_id, configurations, seed, status, concurrency_limit, spend_limit, created_by, started_at, completed_at |
| benchmark_run_items | id, run_id, item_id, configuration_id, execution_id, status; unique run/item/configuration |
| business_value_estimates | id, execution_id, minutes_saved, hourly_rate, value, evidence_class, source, assumption_version |
| audit_events | id, organization_id, actor_id, action, entity_ref, timestamp, safe_metadata |
| jobs | id, type, payload_ref, status, available_at, lease_until, attempts, last_error |

Indexes: executions(organization_id, created_at desc); attempts(execution_id); cost_entries(attempt_id, recorded_at); outcomes(execution_id, observed_at desc); benchmark_run_items(run_id, configuration_id); jobs(status, available_at). Query spending through organization-scoped joins. Preserve raw provider usage for audit while excluding sensitive prompt text.

Migration order: identity → executions/attempts → usage/pricing/ledger → jobs → benchmark/evaluation/outcomes → reporting views. Ledger changes use compensating entries; corrections do not overwrite old costs. An adjustment transaction appends reversal plus replacement and makes repeated reconciliation idempotent.

## 5. Event specification

Separate logical executions from billable attempts. An attempt can fail and still incur cost. A later business outcome can change independently of inference completion.

```json
{
  "schema_version": "1.0",
  "event_id": "uuid",
  "type": "inference.attempt.completed",
  "occurred_at": "2026-10-01T14:00:00Z",
  "execution_id": "uuid",
  "attempt_id": "uuid",
  "trace_id": "opaque-trace-id",
  "attribution": {
    "application_id": "uuid",
    "project_id": "uuid",
    "workflow": "sred_document_analysis",
    "task_type": "technical_analysis",
    "taxonomy_version": "1"
  },
  "model": {
    "provider": "configured-provider",
    "requested_model": "configured-model",
    "resolved_model": "reported-model",
    "parameters": {"temperature": 0, "max_output_tokens": 2000}
  },
  "usage": {
    "source": "provider_reported",
    "input_tokens": 12000,
    "cached_input_tokens": 8000,
    "output_tokens": 700,
    "reasoning_tokens": null
  },
  "performance": {"ttft_ms": 480, "total_latency_ms": 5200},
  "status": "completed",
  "pricing": {"status": "priced", "pricing_version_id": "uuid"}
}
```

Event types: execution.created, attempt.started, attempt.completed, attempt.failed, attempt.cancelled, usage.reconciled, cost.adjusted, outcome.recorded, evaluation.completed. Validate at ingestion, deduplicate by event_id, and preserve schema version. Null means unavailable; zero means observed zero. Distinguish provider-reported usage, tokenizer estimates, and reconciled invoice usage. Unknown prices never become zero cost.

Use OpenTelemetry spans for debugging and correlation. Durable ledger records are authoritative for money; sampled spans are not the billing system. Emit safe metrics for requests, errors, reconciliation lag, unknown cost, queue depth and latency.

## 6. Gateway and provider abstraction

```ts
interface ProviderAdapter {
  capabilities(): {
    streaming: boolean;
    structuredOutput: boolean;
    usageOnStreamEnd: boolean;
    cancellation: boolean;
  };
  execute(request: NormalizedRequest, signal: AbortSignal): Promise<NormalizedResponse>;
  stream(request: NormalizedRequest, signal: AbortSignal): AsyncIterable<NormalizedChunk>;
  normalizeUsage(raw: unknown): NormalizedUsage;
  classifyError(error: unknown): ProviderError;
}
```

Preserve provider-specific parameters in a validated extension object; reject unsupported features. Do not silently drop reasoning effort or structured-output requirements. Configure exact model identifiers in a registry and resolve pricing against the actual reported model where available. Prices and capabilities are configuration, not claims that model names will remain current.

R0 uses explicit model selection. Retry 429 and eligible transient failures with bounded exponential backoff and jitter, honoring Retry-After, at most two retries and an overall deadline. Do not automatically retry after partial output or ambiguous provider acceptance; mark the attempt uncertain and reconcile. Fallback is opt-in and records a separate attempt and provider. Client disconnect triggers cancellation when supported and retains any billable usage.

Persist an attempt before dispatch. After a crash, a lease-expiry reconciler marks unresolved attempts uncertain; it must not blindly resend requests. Exactly-once external execution cannot be guaranteed without provider idempotency. Repeated client requests with the same key and identical body return existing execution state; a different body returns 409. A pending execution returns 202, not a second provider call.

Document contents are untrusted input. Evaluation prompts distinguish task instructions from document text. Document tools and network access remain disabled for the initial benchmark.

## 7. API contracts

Publish OpenAPI 3.1 with JSON Schema validation and generated TypeScript clients. Use bearer application keys for ingestion/execution and organization-scoped user sessions for dashboard actions.

| Endpoint | Contract |
|---|---|
| POST /v1/executions | Explicit provider/model, task type, attribution, input or private input reference, parameters, deadline; requires Idempotency-Key; 201 terminal response or 202 execution handle |
| GET /v1/executions/{id} | State, attempts, safe output reference, usage, costs and unknown-cost flags |
| GET /v1/executions/{id}/events | SSE chunks and durable terminal execution event; reconnect does not execute again |
| POST /v1/inference-events | Instrument existing applications; deduplicated external events, source marked external; 202 accepted |
| POST /v1/executions/{id}/outcomes | Versioned business success/failure and evidence; 201 observation |
| GET /v1/reports/summary | Half-open UTC interval, group filters; totals, coverage, comparison period, currency, data freshness |
| GET /v1/reports/spend | Daily bucket and attribution/model grouping; stable timezone semantics |
| GET /v1/executions | Cursor pagination; bounded date interval and organization-scoped filters |
| POST /v1/benchmark-runs | Immutable dataset version, 3–5 model configurations, evaluator config, concurrency and spend ceilings; 202 run handle |
| GET /v1/benchmark-runs/{id} | Progress, per-task/model metrics, frontier and uncertainty |
| POST /v1/benchmark-runs/{id}/cancel | Stop unsent jobs, cancel active calls where supported; retain incurred costs |
| GET /v1/exports | Asynchronous organization-scoped CSV export with short-lived download URL |

Example execution request:

```json
{
  "task_type": "technical_analysis",
  "attribution": {"project_id": "uuid", "workflow": "sred_document_analysis"},
  "provider": "configured-provider",
  "model": "configured-model",
  "input_ref": "private-object-reference",
  "parameters": {"temperature": 0, "max_output_tokens": 2000},
  "deadline_ms": 30000
}
```

Errors use a stable envelope: error.code, error.message, error.request_id, error.retryable. HTTP 400 invalid input, 401 unauthenticated, 403 scope denied, 409 conflicting idempotency key, 422 unsupported capability, 429 gateway quota, 502 provider failure, 504 deadline. An HTTP error does not imply zero spend; execution detail remains available. Use trace identifiers, not raw provider errors containing request text, in client messages.

## 8. Pricing engine

Rate dimensions include uncached input, cached input, cache writes/storage, output, separately billable reasoning, provider tools, and local compute. Rate selection uses provider, resolved model, deployment, region, request timestamp, context tier and applicable mode. Invoice discounts are separate explicit adjustments.

For a provider where input includes cached tokens and output includes reasoning:

```text
uncached_input = input_tokens - cached_input_tokens
cost = uncached_input × input_rate
     + cached_input_tokens × cached_rate
     + output_tokens × output_rate
     + separately_billable_tools
```

Normalize inclusion semantics per provider before pricing. Never add reasoning tokens a second time if they are already included in output; never assume cache token counts are disjoint. Validate nonnegative quantities and cached_input ≤ input. Tier rules may price the entire request at one rate or marginal bands; encode the provider's rule, not a generic assumption.

Rate records carry source URL, effective dates, retrieval date and reviewer. Missing usage or rates produce pending/unknown cost. Display known spend plus unpriced-attempt count and coverage; do not label a partial amount total spend. Preflight estimates reserve against the benchmark spend ceiling conservatively, then reconcile actual spend. Token ceilings and concurrency bounds limit overshoot; external provider billing delays prevent a mathematically exact hard cap.

Local inference includes measured GPU/CPU duration, configured amortization and utilization assumptions, and allocated hosting costs. Show variable inference spend separately from fully allocated infrastructure cost.

## 9. Economics definitions

- **Spend:** signed cost ledger within the chosen time attribution policy; R1 uses attempt start date, with adjustments shown separately and historical totals restatable.
- **Cost per completed unit:** all costs associated with the cohort / completed logical executions.
- **Cost per successful unit:** all cohort inference costs, including retries and failed executions / observed successful outcomes. If zero successes, report undefined; show numerator, denominator and outcome coverage.
- **Estimated CPS:** mean cost / estimated success probability, explicitly labeled modeled. Do not substitute a rubric score for success probability.
- **Expected total task cost:** inference + human review + retry + error remediation + downstream loss. Avoid double-counting retries already in execution spend. R1 shows observed inference plus optional explicit assumptions for the remaining terms.
- **Benefit:** estimated minutes saved × declared labor rate; distinguish measured, estimated and assumed evidence. Gross benefit subtracts all stated infrastructure costs. Benefit/cost uses the same cost denominator. Do not treat time saved as realized cash savings.
- **Savings opportunity:** baseline counterfactual spend minus proposed spend, with workload, gate accuracy and quality constraints stated. Overlapping opportunities are not additive by default.

Report quality per task type and dataset version. A configuration is dominated when another has cost no higher and success rate no lower, with at least one strict improvement. Filter configurations by quality target and latency SLA before recommending the minimum-cost feasible option. An observed frontier is descriptive; close differences need confidence intervals and paired task analysis before claiming superiority. Missing evaluations exclude a configuration from ranking, with visible reasons.

## 10. Evaluation and benchmark protocol

Initial dataset: 40 approved, de-identified tasks split across extraction, classification, summarization and technical/SR&ED analysis. Reserve a held-out set before tuning. Expand to at least 100 representative tasks per category for reliable operational routing decisions; the initial set is a smoke benchmark, not a production guarantee.

Each item stores immutable inputs, reference evidence, rubric, difficulty, document version and data-use approval. Use exact/field-level checks for extraction and classification. For technical analysis, score evidence grounding, citation validity, factual correctness and completeness; require human review of critical claims. An SR&ED model assessment supports professional review and does not establish eligibility.

Run identical items across configurations, randomize execution order, fix prompt/RAG versions, record nondeterminism and repeat a subset to assess variance. Separate evaluator cost from task inference cost. Blind human reviewers to model identity. Automated judging records judge model, prompt and rubric version; validate it against a human-reviewed sample and flag disagreement. Failed or missing grading stays unknown.

Show accepted/total counts, confidence intervals for acceptance, mean cost with dispersion, p50/p95 latency with sample size, paired cost difference and coverage. Prevent test-set leakage into prompt tuning. A run manifest hashes dataset, prompt, model parameters, evaluator configuration and pricing snapshot.

## 11. Dashboard wireframes

```text
IEOP   Overview | Executions | Benchmark lab | Pricing
Organization / Project / Workflow     Sep 1–30, 2026     USD
Data through 14:00 UTC • Demo or Live indicator • Coverage 98.7%

Known spend       Cost/success       Observed success     Est. benefit
$14,200           $0.184             94.2% (n=...)        $184,000
127 unpriced      91% outcome coverage                   Assumptions →

Daily spend [trend]                  Spend by workflow [stacked bars]

Model economics
Model       Attempts   Spend   Accepted/n   p95 latency   Cost/success
...

Optimization candidates — modeled, requires validation
Candidate       Baseline   Proposed   Est. savings   Quality evidence
...
```

Execution detail: attribution → logical execution status → attempt timeline → provider usage provenance → pricing version/rate calculation → outcome/evaluation evidence. Prompt/output content appears only if retained and the user has explicit content access.

Benchmark lab: select versioned dataset and model configurations → review estimated spend and ceiling → launch → progress/cancel → comparison table and cost/quality frontier → per-item output comparison and grading evidence → export manifest. No invented live values; fixtures carry a persistent Demo label.

Pricing screen: rates, effective intervals, sources, verification status, unpriced attempts and reconciliation action. Changes create new versions and audit records.

## 12. Privacy, operations and reliability

Default to metadata-only telemetry. Benchmark documents and outputs are private, encrypted, organization-scoped objects with retention rules; do not send sensitive payloads to logs. Use hashed user identifiers where person-level attribution is unnecessary. Document explicit provider data-processing and residency terms before client workloads.

Initial configurable defaults: safe operational logs 30 days, benchmark content 30 days, metadata and ledger 12 months, subject to contractual and statutory requirements. Deleting content removes its object and searchable derivatives; financial records can retain non-content provenance when required. Define deletion behavior before onboarding.

Dashboard roles: viewer (aggregates), analyst (traces and benchmark metadata), content reviewer (authorized outputs), administrator (keys/pricing). Benchmark launching has a separate permission and spend ceiling. Audit launches, content access, exports, key changes and price changes.

Set availability and latency SLOs after a measured baseline; separate gateway overhead from provider latency. Alert on unknown-cost accumulation, reconciliation lag, persistent provider failures, queue stalls and failed backups. Bound queue concurrency per provider and organization. Lease workers transactionally; recover expired jobs without duplicating provider calls. Test restore and reconciliation, not only successful requests.

## 13. Six-week engineering backlog

Assumption: two engineers plus part-time domain reviewer; roughly 60 engineering person-days. Estimates below are planning ranges, excluding credential procurement, contractual review and dataset approval. If staffing is lower, preserve dependency order and extend the schedule.

| Week / ticket | Deliverable | Acceptance criteria | Estimate |
|---|---|---|---|
| 1 / IEOP-01 | Contracts, taxonomy and ADRs | Execution vs attempt, success definition, attribution and USD rules reviewed | 2d |
| 1 / IEOP-02 | Repository, CI and local stack | Clean checkout runs API/worker/Postgres; lint/typecheck and migrations pass | 2d |
| 1 / IEOP-03 | Identity and core schema | Scoped keys, cross-org constraints and migration tests pass | 4d |
| 1 / IEOP-04 | Approved benchmark manifest | 40 de-identified items, rubrics and held-out split approved | reviewer + 1d |
| 2 / IEOP-05 | Gateway and first adapter | Success, error, deadline, usage and explicit model paths captured | 4d |
| 2 / IEOP-06 | Idempotency/retry lifecycle | Concurrent duplicate does not dispatch twice; ambiguous failure remains uncertain | 3d |
| 2 / IEOP-07 | Additional adapters | Three model configurations across at least two providers normalize verified fixtures | 3d |
| 3 / IEOP-08 | Versioned price registry | Effective dates, cache/reasoning semantics and tier fixtures reconcile exactly | 4d |
| 3 / IEOP-09 | Ledger/reconciliation worker | Idempotent corrections; unknown cost remains visible; crash recovery tested | 3d |
| 3 / IEOP-10 | Reporting API | Filtered aggregates reconcile to ledger; timezone boundaries and pagination pass | 3d |
| 4 / IEOP-11 | Overview and execution UI | Drilldown preserves filters; trace shows retry costs and coverage | 5d |
| 4 / IEOP-12 | Export and access controls | CSV agrees with reports; cross-org/content access denied and audited | 2d |
| 4 / IEOP-13 | Thin evaluator | Versioned deterministic checks and human rubric submission supported | 3d |
| 5 / IEOP-14 | Benchmark orchestrator | Same items run through 3–5 models; ceilings, cancellation and resumability verified | 4d |
| 5 / IEOP-15 | Economic comparison | Correct cohort CPS, Pareto set, feasibility filters and uncertainty display | 3d |
| 5 / IEOP-16 | Benchmark lab UI | Launch/review/progress/comparison/export journey works end to end | 3d |
| 6 / IEOP-17 | Reliability and privacy hardening | Streaming cancellation, failure billing, log redaction and retention tests pass | 3d |
| 6 / IEOP-18 | Pilot and financial reconciliation | Approved tasks run live; reconcile available provider usage/billing; discrepancies documented | 3d |
| 6 / IEOP-19 | Runbooks and handover | Restore drill, price update guide, alerts and pilot evidence delivered | 2d |
| 6 / buffer | Integration and pilot fixes | No unresolved release-blocking discrepancies or isolation failures | 2d |

Dependencies: 01–03 before 05; 04 before 14; 05–07 before 08–09 integration; 08–10 before 11; 13–15 before final comparison; all core paths before 18. If a third provider is unavailable, keep three configurations across two providers and disclose the limitation.

## 14. Required verification

Pricing golden fixtures cover uncached/cached usage, reasoning inclusion, tier thresholds, tools, missing rates, price changes, failed billable calls, zero usage and corrections. Provider contract tests use recorded sanitized fixtures and stubs; live smoke tests are opt-in and spend-limited.

Integration tests cover concurrent idempotency, client disconnect, worker crash after dispatch, retry spend, organization isolation, late outcomes, date boundaries and unknown costs. Economics fixtures include zero successes, partial coverage, dominated/equal models, failed tasks and infeasible quality/SLA targets. End-to-end tests cover benchmark launch/cancel/export and dashboard reconciliation.

Release evidence includes dataset/run manifest, pricing provenance, per-item results, evaluation coverage, ledger-to-provider reconciliation and a list of unresolved billing timing differences. Invoice reconciliation may require waiting for provider billing; mark it pending instead of asserting exact agreement.

## 15. Decisions to settle during kickoff

Confirm initial provider accounts and exact model IDs; approved document source and data residency; workload success definition; content-retention requirements; labor-rate assumptions; staffing; and the first pilot application. These decisions gate live processing, not repository scaffolding or fixture-based development.

After R1, prioritize R2 quality coverage before automated routing. Evaluate caching/context reduction in controlled experiments, and add policy enforcement only after the cost and quality signals are reliable enough to govern real work.
