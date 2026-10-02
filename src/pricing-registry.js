import {manifestHash} from './benchmark.js';
import {priceUsage} from './index.js';
const fields=['provider','model','region','deployment'];
function timestamp(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new TypeError('Pricing timestamps must be canonical UTC ISO strings');
  return Date.parse(value);
}
/** Reviewed, effective-dated exact matches. No silent aliases or price defaults. */
export function createPricingRegistry(records) {
  const snapshots=structuredClone(records);
  for(const row of snapshots){
    for(const key of [...fields,'version'])if(typeof row[key]!=='string'||!row[key])throw new TypeError(`Missing pricing ${key}`);
    if(row.currency!=='USD')throw new TypeError('Only USD pricing is supported');
    timestamp(row.effectiveFrom);if(row.effectiveUntil!==null&&timestamp(row.effectiveUntil)<=timestamp(row.effectiveFrom))throw new TypeError('Invalid pricing interval');
    const source=new URL(row.sourceUrl);if(source.protocol!=='https:')throw new TypeError('Pricing source must use HTTPS');
    if(typeof row.reviewedBy!=='string'||!row.reviewedBy)throw new TypeError('Pricing reviewer is required');
    timestamp(row.reviewedAt);
    priceUsage({inputTokens:0,outputTokens:0},{...row.rates,version:row.version});
  }
  for(let i=0;i<snapshots.length;i++)for(let j=i+1;j<snapshots.length;j++){
    const a=snapshots[i],b=snapshots[j];
    if(a.version===b.version)throw new TypeError('Pricing versions must be unique');
    if(fields.every(k=>a[k]===b[k])&&timestamp(a.effectiveFrom)<(b.effectiveUntil===null?Infinity:timestamp(b.effectiveUntil))&&timestamp(b.effectiveFrom)<(a.effectiveUntil===null?Infinity:timestamp(a.effectiveUntil)))throw new TypeError('Ambiguous overlapping pricing intervals');
  }
  const hash=manifestHash(snapshots);
  return {hash,
    resolve(query){const at=timestamp(query.timestamp);const row=snapshots.find(r=>fields.every(k=>r[k]===query[k])&&timestamp(r.effectiveFrom)<=at&&(r.effectiveUntil===null||at<timestamp(r.effectiveUntil)));return row?structuredClone({...row,registryHash:hash}):null;},
    price(query,usage){const row=this.resolve(query);return row?{...priceUsage(usage,{...row.rates,version:row.version}),registryHash:hash,sourceUrl:row.sourceUrl,reviewedBy:row.reviewedBy}:{status:'unknown',usd:null,nanoUsd:null,reason:'No exact effective-dated rate match',registryHash:hash};}
  };
}
