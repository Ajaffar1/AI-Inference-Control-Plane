# AI Inference Control Plane

**Understand the cost of successful AI work.** A local-first Node.js library and dashboard for inference telemetry, explicit pricing, outcomes, and model economics.

This is an early, usable R0/R1 foundation. It runs without dependencies or API keys. It is not yet a production multi-tenant gateway or a published npm package.

## Try the dashboard

Requires Node.js 22 or later.

```sh
git clone https://github.com/Ajaffar1/AI-Inference-Control-Plane.git
cd AI-Inference-Control-Plane
npm run demo
```

Open **http://127.0.0.1:3000**. Demo mode is read-only and uses clearly labeled illustrative data and rates. It does not call paid models.

## Record your own data

```sh
npm run example
# Generate a token, then set IEOP_TOKEN in your shell:
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
export IEOP_TOKEN='your-generated-token'
npm start
```

Enter that token in the dashboard. Tokens stay in tab memory. The server listens on loopback only; do not expose it as a public hosted service. `PORT` defaults to 3000; `IEOP_DATA` defaults to `./data/events.jsonl`. Stop demo mode before starting the real-data server on the same port.

## Use the library

Import directly from the cloned repository:

```js
import { createTracker } from './src/index.js';
import { EventStore } from './src/store.js';

const store = new EventStore('./data/events.jsonl');
const tracker = createTracker({ record: event => store.append(event) });
const { output, event } = await tracker.track({
  project: 'Document intelligence',
  task: 'Extraction',
  provider: 'your-provider',
  model: 'your-model',
  rates: {
    version: 'your-reviewed-rate-version',
    input: 1000000, cachedInput: 200000, output: 3000000
  }
}, async () => {
  // Replace this with your SDK call; normalize its reported usage.
  return { output: { invoiceTotal: 125 }, usage: {
    inputTokens: 1000, cachedInputTokens: 200, outputTokens: 100
  }};
});
// Record a business outcome after evaluation or human review.
await store.recordOutcome(event.executionId, true);
```

Rates are integer **USD microdollars per million tokens**: 1,000,000 means $1 per million tokens. Example rates are illustrative. Input includes cached input; output must include any reasoning tokens already billed as output. Provider adapters must normalize these semantics. Missing usage/rates remain unknown. Tool, cache-storage, context tiers, discounts and infrastructure pricing are not implemented yet.

`track` records failures, including reported billable usage attached to `error.usage`. It never retries automatically. If you retry, reuse `executionId` to attribute costs to one task; this version requires all attempts for that execution to use the same project/task/model/provider. Do not claim inference success is a business outcome. Persistence errors after successful inference expose `error.output` and `error.event`; avoid repeating a paid call merely because logging failed.

## Local API

All real-data API routes require `Authorization: Bearer <IEOP_TOKEN>`.

- `GET /api/report?project=...&task=...`: events, grouped economics and observed frontier.
- `POST /api/events`: a validated event from `createEvent`; event IDs deduplicate exact replays and reject conflicting content. Maximum 64 KiB.
- `POST /api/outcomes`: `{ "executionId": "...", "accepted": true }`; appends an outcome observation. Latest observation wins.

Prompts and outputs are not stored by the tracker. Attribution metadata can still be sensitive; secure the data directory. JSONL is a single-process development store that loads all events into memory. Use one writer process; do not use it for high-volume or concurrent multi-process ingestion. There is no organization isolation, TLS termination, provider execution endpoint, automatic routing, or full pricing reconciliation yet.

## Economics

Known spend includes failed attempts and retries. Successful units count logical executions, not attempts. Cost per success is shown only for fully priced cohorts with complete outcome coverage and at least one success. Missing values display as unknown, not zero. Model comparisons are grouped by project and task. The observed Pareto frontier compares average inference cost against acceptance; different task sets and small samples limit conclusions. There are no statistical confidence intervals or latency constraints in frontier selection yet.

## Development

```sh
npm test
npm run example
```

CI runs the pricing, retry economics, frontier, storage and HTTP tests on Node.js 22 and 24. No dependency installation is needed. See [technical blueprint](docs/blueprint.md) for the full schema, API design and six-week roadmap.

Next milestones: versioned provider price registry; normalized provider adapters; PostgreSQL ledger; reproducible 3–5 model benchmark with domain rubrics; quality confidence intervals; production authentication and tenancy. Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. This repository is public and usable from source; npm publication and hosted deployment are separate future steps.
