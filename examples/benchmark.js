import {writeFile,mkdir} from 'node:fs/promises';
import {runBenchmark,pairedComparison,wilsonInterval} from '../src/benchmark.js';
const manifest={schemaVersion:1,datasetVersion:'synthetic-extraction-v1',promptVersion:'extract-v1',rubricVersion:'exact-total-v1',tasks:Array.from({length:40},(_,i)=>({id:`task-${i}`,total:100+i})),configurations:[{id:'control',estimatedMaxCost:.02},{id:'treatment',estimatedMaxCost:.008}]};
const run=await runBenchmark({manifest,spendLimit:2,execute:async({task,configuration})=>({output:{total:configuration.id==='treatment'&&Number(task.id.split('-')[1])%10===0?0:task.total},cost:configuration.id==='control'?.02:.008}),evaluate:async({task,output})=>task.total===output.total});
const group=id=>run.results.filter(r=>r.configurationId===id&&r.status==='completed').map(r=>({taskId:r.taskId,cost:r.cost,accepted:r.accepted}));
const comparison=pairedComparison(group('control'),group('treatment'));
const intervals=Object.fromEntries(manifest.configurations.map(c=>{const rows=group(c.id);return [c.id,wilsonInterval(rows.filter(r=>r.accepted).length,rows.length)];}));
await mkdir('data',{recursive:true});await writeFile('data/benchmark.json',JSON.stringify({demo:true,...run,comparison,intervals},null,2));
console.log(JSON.stringify({demo:true,manifestHash:run.manifestHash,actualSpend:run.actualSpend,comparison,intervals},null,2));
