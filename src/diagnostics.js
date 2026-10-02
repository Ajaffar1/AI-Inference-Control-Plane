import { validateEvent } from './index.js';
/** Provider usage semantics are explicit; unknown quantities stay null. */
export function normalizeOpenAIUsage(usage) {
  if (!usage || typeof usage!=='object') return null;
  const input=usage.input_tokens??usage.prompt_tokens;
  const output=usage.output_tokens??usage.completion_tokens;
  if(input===undefined||output===undefined)return null;
  const cached=(usage.input_tokens_details??usage.prompt_tokens_details)?.cached_tokens??0;
  for(const [name,value] of Object.entries({input,output,cached}))if(!Number.isSafeInteger(value)||value<0)throw new TypeError(`Invalid ${name} token count`);
  if(cached>input)throw new TypeError('Cached input exceeds input');
  return {inputTokens:input,cachedInputTokens:cached,outputTokens:output};
}
export function diagnose(events) {
  const ids=new Set(), executions=new Map(), pricingVersions=new Set();
  let duplicateIds=0,unpriced=0,failed=0,input=0,cached=0,output=0;
  for(const e of events){validateEvent(e);if(ids.has(e.id))duplicateIds++;ids.add(e.id);if(e.cost.status==='unknown')unpriced++;if(e.status==='failed')failed++;if(e.rates?.version)pricingVersions.add(e.rates.version);if(e.usage){input+=e.usage.inputTokens;cached+=e.usage.cachedInputTokens??0;output+=e.usage.outputTokens;}const previous=executions.get(e.executionId)??0;executions.set(e.executionId,previous+1);}
  return {attempts:events.length,logicalExecutions:executions.size,duplicateIds,unpriced,failed,retryAttempts:[...executions.values()].reduce((s,n)=>s+n-1,0),pricingVersions:[...pricingVersions].sort(),tokens:{input,cached,output},cacheTokenRatio:input?cached/input:null,findings:[...(duplicateIds?[{severity:'error',message:'Duplicate event IDs can double count spend.'}]:[]),...(unpriced?[{severity:'warning',message:`${unpriced} attempts have unknown cost; known spend is incomplete.`}]:[]),...(failed?[{severity:'info',message:`${failed} failed attempts remain in the cost cohort.`}]:[])]};
}
