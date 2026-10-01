import { createTracker } from '../src/index.js';
import { EventStore } from '../src/store.js';
const store = new EventStore(process.env.IEOP_DATA ?? './data/events.jsonl');
const tracker = createTracker({record:event => store.append(event)});
const result = await tracker.track({project:'Example project',task:'Extraction',provider:'Mock',model:'example-model',rates:{version:'example-v1',input:1000000,cachedInput:200000,output:3000000}},async()=>({output:{invoiceTotal:125},usage:{inputTokens:1000,cachedInputTokens:200,outputTokens:100}}));
await store.recordOutcome(result.event.executionId, true);
console.log({executionId:result.event.executionId,cost:result.event.cost,output:result.output});
