import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {collapseGovernanceScene} from '../src/governance-collapse.js';
const presentation=JSON.parse(readFileSync('src/presentation-scenes.json'));
const routes=JSON.parse(readFileSync('src/governance-routes.json'));
if(!isMainThread) {
 parentPort.on('message',job=>{
  if(!job){parentPort.close();return;}
  try {
   const scene={...presentation[job.language].architectureScenes.central,projectionKey:'overview',edges:routes[job.language].overview};
   const ids=scene.groups.filter((g,i)=>job.mask&(1<<i)).map(g=>g.id);
   const result=collapseGovernanceScene(scene,ids,false,job.hint);
   if(!result.routingPlan)throw Error('Missing route plan');
   parentPort.postMessage({...job,plan:result.routingPlan});
  }catch(error){parentPort.postMessage({...job,error:error.stack});}
 });
}else{
 const key=createHash('sha256').update(['architecture-routing.js','architecture-layout.js','governance-layout.js','governance-collapse.js','presentation-scenes.json']
  .map(f=>readFileSync('src/'+f)).join('\n')).digest('hex');
 const plans={fr:{},en:{}},seeds={fr:{},en:{}},jobs=[],cache='.cache/fold-plans.jsonl',hints=new Map();
 const remember=(topo,plan)=>{const list=hints.get(topo)??[];if(!list.some(p=>JSON.stringify(p)===JSON.stringify(plan)))list.push(plan);hints.set(topo,list.slice(-16));};
 const topology=(language,mask)=>{
  const scene=presentation[language].architectureScenes.central;
  const entries=new Map([...scene.groups,...scene.nodes].map(g=>[g.id,g]));
  const collapsed=new Set(scene.groups.filter((g,i)=>mask&(1<<i)).map(g=>g.id));
  const rep=id=>{let visible=id;for(let p=entries.get(id)?.parentId;p;p=entries.get(p)?.parentId)if(collapsed.has(p))visible=p;return visible;};
  const seen=new Set(),edges=[];
  for(const edge of routes[language].overview){const s=rep(edge.source),t=rep(edge.target),pair=s+':'+t;if(s!==t&&!seen.has(pair)){seen.add(pair);edges.push([edge.id,s,t]);}}
  return JSON.stringify(edges);
 };
 try{for(const line of readFileSync(cache,'utf8').trim().split('\n')){const v=JSON.parse(line);seeds[v.language][v.mask]=v.plan;remember(topology(v.language,v.mask),v.plan);if(v.key===key)plans[v.language][v.mask]=v.plan;}}catch{}
 for(const language of ['fr','en']) {
  const scene=presentation[language].architectureScenes.central,groups=scene.groups;
  const indices=new Map(groups.map((g,i)=>[g.id,i]));
  const roots=groups.filter(g=>!g.parentId).map(g=>indices.get(g.id));
  const ready=new Set(routes[language].folded.map(f=>JSON.parse(f.signature)[0]
   .reduce((mask,[id,,,,,,,collapsed])=>mask|(collapsed?1<<indices.get(id):0),0)));
  const seen=new Set();
  for(let mask=1;mask<2**groups.length;mask++) {
   const visible=groups.reduce((value,g,i)=>{
    for(let p=g.parentId;p;p=groups[indices.get(p)].parentId)if(mask&(1<<indices.get(p)))return value;
    return value|(mask&(1<<i));
   },0);
   if(seen.has(visible)||roots.every(i=>visible&(1<<i)))continue;
   seen.add(visible);
   if(!ready.has(visible)&&!plans[language][visible])jobs.push({language,mask:visible});
  }
 }
 const total=jobs.length;let completed=0;
 console.log(`Preparing ${total} missing overview fold plans.`);
 const workers=[];
 try{
  await Promise.all(Array.from({length:Math.min(4,jobs.length)},()=>new Promise((resolve,reject)=>{
   const worker=new Worker(new URL(import.meta.url));workers.push(worker);
   worker.on('error',reject);
   worker.on('message',result=>{
    if(result.error){reject(Error(result.error));return;}
    plans[result.language][result.mask]=result.plan;
    remember(result.topology,result.plan);
    appendFileSync(cache,JSON.stringify({key,...result,hint:undefined})+'\n');
    if(++completed%20===0){const message=`Fold plans ${completed}/${total}`;console.log(message);writeFileSync('.cache/fold-plan-progress.txt',message+'\n');}
    dispatch();
   });
   const dispatch=()=>{const next=jobs.shift();if(next){next.topology=topology(next.language,next.mask);const exact=seeds[next.language][next.mask]??seeds.fr[next.mask];worker.postMessage({...next,hint:[...(exact?[exact]:[]),...(hints.get(next.topology)??[])]});}else{worker.postMessage(null);resolve();}};
   dispatch();
  })));
 }finally{await Promise.all(workers.map(w=>w.terminate()));}
 const current=JSON.parse(readFileSync('src/governance-routes.json'));
 for(const language of ['fr','en'])current[language].plans=plans[language];
 writeFileSync('src/governance-routes.json',JSON.stringify(current)+'\n');
 console.log(JSON.stringify({plans:Object.fromEntries(Object.entries(plans).map(([lang,p])=>[lang,Object.keys(p).length])),bytes:JSON.stringify(plans).length}));
}
