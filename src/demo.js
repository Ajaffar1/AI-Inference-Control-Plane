import { createEvent } from './index.js';
export function demoEvents() {
  return Array.from({length:90}, (_,i) => {
    const tier = i % 3;
    const e = createEvent({executionId:`demo-${i}`, project:'Document intelligence', task:i < 45 ? 'Extraction' : 'Technical analysis', provider:['Local','API','API'][tier], model:['Small model','Balanced model','Frontier model'][tier], usage:{inputTokens:12000+i*70,cachedInputTokens:4000,outputTokens:600+i*3}, rates:{version:'illustrative-not-provider-pricing',input:[100000,1000000,5000000][tier],cachedInput:[20000,200000,1000000][tier],output:[300000,3000000,15000000][tier]},latencyMs:800+tier*1600+i*18,accepted:i % [5,11,23][tier] !== 0});
    e.timestamp = new Date(Date.UTC(2026,8,1+i%30)).toISOString();
    return e;
  });
}
