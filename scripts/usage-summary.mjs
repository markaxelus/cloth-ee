import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

// Builds the two files the OMNI LIVE organisers ask for from the server's call log.
const log=process.argv[2]||process.env.OMNI_USAGE_LOG||'artifacts/yibu_api_calls.jsonl';
const records=(await readFile(log,'utf8')).split('\n').filter(Boolean).map(l=>JSON.parse(l));
const blank=()=>({calls:0,success:0,failure:0,input_tokens:0,output_tokens:0,total_tokens:0,missing_usage:0});
const add=(t,r)=>{t.calls++;r.success?t.success++:t.failure++;if(r.total_tokens==null)t.missing_usage++;t.input_tokens+=r.input_tokens??0;t.output_tokens+=r.output_tokens??0;t.total_tokens+=r.total_tokens??0;};
const totals=blank(),groups=new Map();
for(const r of records){
  add(totals,r);
  const key=[r.model,r.key_suffix,r.purpose].join(',');
  add(groups.get(key)??groups.set(key,blank()).get(key),r);
}
const grouped=[...groups].map(([key,t])=>{const [model,key_suffix,purpose]=key.split(',');return {model,key_suffix,purpose,...t};});
const dir=path.dirname(log),times=records.map(r=>r.started_at).sort();
await writeFile(path.join(dir,'usage_summary.json'),JSON.stringify({source:{log,first_call:times[0]??null,last_call:times.at(-1)??null},totals,grouped},null,2)+'\n');
const columns=['model','key_suffix','purpose','calls','success','failure','input_tokens','output_tokens','total_tokens','missing_usage'];
await writeFile(path.join(dir,'usage_by_model_key_purpose.csv'),[columns.join(','),...grouped.map(g=>columns.map(c=>g[c]).join(','))].join('\n')+'\n');
console.log(`${totals.calls} calls, ${totals.total_tokens} tokens (${totals.missing_usage} without usage) → ${dir}/usage_summary.json, ${dir}/usage_by_model_key_purpose.csv`);
