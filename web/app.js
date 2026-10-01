const $ = id => document.getElementById(id);
const money = n => n === null ? '—' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:n<1?4:2}).format(n);
const pct = n => n === null ? '—' : `${(n*100).toFixed(1)}%`;
let token = '', report;
const element = (tag,text,className) => {const e=document.createElement(tag);e.textContent=text;if(className)e.className=className;return e;};
function tableRow(values){const tr=element('tr','');for(const v of values)tr.append(element('td',v));return tr;}
async function load(){
  $('error').textContent='';
  try {
    const response=await fetch(`/api/report?project=${encodeURIComponent($('project').value)}`,{headers:token?{Authorization:`Bearer ${token}`}:{}});
    if(response.status===401){$('auth').hidden=false;$('mode').textContent='Authentication required';return;}
    if(!response.ok)throw new Error('Could not load report');
    report=await response.json();$('auth').hidden=true;$('mode').textContent=report.demo?'DEMO • illustrative data':'LOCAL • recorded data';
    const selected=$('project').value;$('project').replaceChildren(new Option('All projects',''),...report.projects.map(p=>new Option(p,p)));$('project').value=selected;
    const rows=report.rows, spend=rows.reduce((a,r)=>a+r.knownSpend,0), unpriced=rows.reduce((a,r)=>a+r.unpriced,0), units=rows.reduce((a,r)=>a+r.executions,0), successes=rows.reduce((a,r)=>a+r.successes,0), observed=rows.reduce((a,r)=>a+r.observed,0);
    $('spend').textContent=money(spend);$('coverage').textContent=`${unpriced} unpriced attempts`;$('cps').textContent=money(!unpriced&&observed===units&&successes?spend/successes:null);$('success').textContent=pct(observed?successes/observed:null);$('outcomes').textContent=`${observed}/${units} outcomes observed`;$('attempts').textContent=report.events.length;$('units').textContent=`${units} logical executions`;
    $('models').replaceChildren(...rows.map(r=>tableRow([`${r.model} / ${r.task}`,money(r.knownSpend),`${r.successes}/${r.observed} (${pct(r.successRate)})`,money(r.costPerSuccess),`${(r.p95LatencyMs/1000).toFixed(2)}s`,`${pct(r.outcomeCoverage)} outcomes; ${r.unpriced} unpriced`])));
    $('events').replaceChildren(...report.events.slice().sort((a,b)=>b.timestamp.localeCompare(a.timestamp)).slice(0,50).map(e=>tableRow([e.model,e.task,e.status,e.accepted===null?'Unknown':e.accepted?'Accepted':'Rejected',money(e.cost.usd),e.usage?`${e.usage.inputTokens} in / ${e.usage.outputTokens} out`:'Unavailable'])));
    const byModel=new Map();for(const r of rows)byModel.set(r.model,(byModel.get(r.model)||0)+r.knownSpend);
    $('bars').replaceChildren();const maximum=Math.max(...byModel.values(),1e-9);
    for(const [model,cost] of byModel){const row=element('div','','bar-row'),label=element('div','','bar-label');label.append(element('span',model),element('span',money(cost)));const track=element('div','','bar-track'),bar=element('div','','bar');bar.style.width=`${cost/maximum*100}%`;track.append(bar);row.append(label,track);$('bars').append(row);}
    $('frontier').replaceChildren(...report.frontier.map(r=>{const e=element('div',`${r.model} · ${r.task}`,'frontier-item');e.append(element('small',`${money(r.knownSpend/r.executions)} / task · ${pct(r.successRate)} accepted · n=${r.executions}`));return e;}));
    if(!rows.length){$('bars').textContent='No events yet. Run npm run example to record your first attempts.';$('frontier').textContent='No evaluated configurations yet.';}
  }catch(error){$('error').textContent=error.message;}
}
$('project').addEventListener('change',load);$('refresh').addEventListener('click',load);$('connect').addEventListener('click',()=>{token=$('token').value;$('token').value='';load();});
$('export').addEventListener('click',()=>{if(!report)return;const keys=['project','task','provider','model','attempts','executions','knownSpend','unpriced','successes','observed','costPerSuccess'];const csv=[keys,...report.rows.map(r=>keys.map(k=>r[k]??''))].map(row=>row.map(v=>{const s=String(v);return '"'+(/^[=+\-@\t\r]/.test(s)?"'":'')+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=element('a','');a.href=url;a.download='inference-economics.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
load();
