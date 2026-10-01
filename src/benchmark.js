import { createHash } from 'node:crypto';

function canonical(value) {
  if (value === null) return 'null';
  if (typeof value !== 'object') {
    if (!['string','boolean','number'].includes(typeof value) || (typeof value==='number' && !Number.isFinite(value))) throw new TypeError('Manifest requires finite JSON-compatible values');
    return JSON.stringify(value);
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value)!==Object.prototype) throw new TypeError('Manifest requires plain JSON objects');
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
}
export function manifestHash(manifest) {
  return createHash('sha256').update(canonical(manifest)).digest('hex');
}
export function wilsonInterval(successes, total) {
  const z = 1.959963984540054;
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(successes) || total < 0 || successes < 0 || successes > total || !Number.isFinite(z) || z <= 0) throw new TypeError('Invalid confidence interval inputs');
  if (!total) return null;
  const p=successes/total, denominator=1+z*z/total;
  const center=(p+z*z/(2*total))/denominator;
  const margin=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/denominator;
  return {lower:Math.max(0,center-margin),upper:Math.min(1,center+margin),confidence:.95,method:'Wilson score (independent binary observations)'};
}
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {state += 0x6D2B79F5;let t=state;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
}
/** Paired bootstrap resamples task IDs, preserving within-task correlation. */
export function pairedComparison(control, treatment, {seed=42, iterations=2000}={}) {
  if (!Number.isSafeInteger(iterations) || iterations < 100 || iterations > 10000 || !Number.isSafeInteger(seed)) throw new TypeError('Invalid bootstrap configuration');
  const validate = rows => {
    const map=new Map();
    for(const row of rows) {
      if(typeof row.taskId!=='string'||!row.taskId||map.has(row.taskId)||!Number.isFinite(row.cost)||row.cost<0||typeof row.accepted!=='boolean') throw new TypeError('Comparison needs unique task IDs, nonnegative costs, and boolean outcomes');
      map.set(row.taskId,row);
    }
    return map;
  };
  const a=validate(control),b=validate(treatment);
  const paired=[...a].filter(([id])=>b.has(id)).sort(([x],[y])=>x.localeCompare(y)).map(([id,row])=>({cost:b.get(id).cost-row.cost,quality:Number(b.get(id).accepted)-Number(row.accepted)}));
  if(!paired.length) return {pairedTasks:0,excludedControl:a.size,excludedTreatment:b.size,costDelta:null,acceptanceDelta:null};
  const random=seededRandom(seed), costSamples=[],qualitySamples=[];
  for(let i=0;i<iterations;i++){let c=0,q=0;for(let j=0;j<paired.length;j++){const p=paired[Math.floor(random()*paired.length)];c+=p.cost;q+=p.quality;}costSamples.push(c/paired.length);qualitySamples.push(q/paired.length);}
  const summarize = (key,samples) => {samples.sort((a,b)=>a-b);return {mean:paired.reduce((s,p)=>s+p[key],0)/paired.length,lower:samples[Math.floor(iterations*.025)],upper:samples[Math.ceil(iterations*.975)-1]};};
  return {pairedTasks:paired.length,excludedControl:a.size-paired.length,excludedTreatment:b.size-paired.length,costDelta:summarize('cost',costSamples),acceptanceDelta:summarize('quality',qualitySamples),seed,iterations,method:'paired task bootstrap, percentile 95% intervals',caveat:'Small or unrepresentative task sets cannot establish production superiority.'};
}

/** Adapter-injected, bounded execution. Reserves caller estimates before dispatch. */
export async function runBenchmark({manifest, execute, evaluate, concurrency=2, spendLimit=1, signal}) {
  if (!manifest || !Array.isArray(manifest.tasks) || !manifest.tasks.length || !Array.isArray(manifest.configurations) || !manifest.configurations.length || typeof execute!=='function' || typeof evaluate!=='function') throw new TypeError('Invalid benchmark');
  if (!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>32||!Number.isFinite(spendLimit)||spendLimit<0) throw new TypeError('Invalid benchmark limits');
  for(const group of [manifest.tasks,manifest.configurations]) {
    if(group.some(x=>typeof x.id!=='string'||!x.id)||new Set(group.map(x=>x.id)).size!==group.length)throw new TypeError('Task and configuration IDs must be unique');
  }
  for(const c of manifest.configurations)if(!Number.isFinite(c.estimatedMaxCost)||c.estimatedMaxCost<0)throw new TypeError('Each configuration requires an estimatedMaxCost');
  const hash=manifestHash(manifest), jobs=manifest.tasks.flatMap(task=>manifest.configurations.map(configuration=>({task,configuration}))), results=Array(jobs.length);
  let next=0, actualSpend=0,reserved=0,unknownCosts=0;
  async function worker(){
    while(next<jobs.length){
      const index=next++,{task,configuration}=jobs[index];
      if(signal?.aborted){results[index]={taskId:task.id,configurationId:configuration.id,status:'cancelled'};continue;}
      if(unknownCosts || actualSpend+reserved+configuration.estimatedMaxCost>spendLimit){results[index]={taskId:task.id,configurationId:configuration.id,status:'budget_skipped'};continue;}
      reserved+=configuration.estimatedMaxCost;
      let cost=null,result;
      const base={taskId:task.id,configurationId:configuration.id};
      try {
        result=await execute({task,configuration,signal});
        if(!Number.isFinite(result.cost)||result.cost<0)throw new TypeError('Adapter must return a finite nonnegative cost');
        cost=result.cost;
        try {const accepted=await evaluate({task,configuration,output:result.output,signal});if(typeof accepted!=='boolean')throw new TypeError('Evaluator must return boolean');results[index]={...base,status:'completed',cost,accepted};}
        catch {results[index]={...base,status:'evaluation_failed',cost,accepted:null};}
      }catch(error){if(Number.isFinite(error?.cost)&&error.cost>=0)cost=error.cost;results[index]={...base,status:'execution_failed',cost,accepted:null};}
      finally {reserved-=configuration.estimatedMaxCost;if(cost===null)unknownCosts++;else actualSpend+=cost;}
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency,jobs.length)},worker));
  return {manifestHash:hash,manifest,actualSpend,unknownCosts,spendLimit,budgetExceeded:actualSpend>spendLimit,results,limits:'Reservations rely on caller estimates. In-flight calls and provider billing can exceed the limit. Evaluation costs must be tracked separately.'};
}
