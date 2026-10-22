import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { architectureScenes, decisionScenes, ROUTED_NEEDS, GIGOGNE_VIEWS } from '../src/architecture.js';
import { localize } from '../src/i18n.js';
import { packGovernanceScene } from '../src/governance-layout.js';
import { packStudyScene } from '../src/study-layout.js';
import { routeScene } from '../src/architecture-routing.js';
import { collapseGovernanceScene } from '../src/governance-collapse.js';
import { withLegend } from '../src/governance-legend.js';
const routes={},presentation={navigation:{needs:ROUTED_NEEDS,views:GIGOGNE_VIEWS}};
const hash=value=>createHash('sha256').update(value).digest('hex');
// Diagnostic metadata does not change route geometry or invalidate the cache.
const algorithm=hash(['architecture-routing.js','architecture-layout.js','governance-layout.js','study-layout.js','governance-collapse.js','governance-summary.js'].map(f=>readFileSync('src/'+f,'utf8').replace(/^[ \t]*obstacleDetour: selected\.points\.length > 2,\n/gm,'')).join('\n'));
let cache={};try{cache=JSON.parse(readFileSync(process.cwd()+'/.cache/route-cache.json','utf8'));}catch{}
const cached=(input,compute)=>{
 const key=hash(algorithm+JSON.stringify(input));
 if(!cache[key]){cache[key]=compute();writeFileSync(process.cwd()+'/.cache/route-cache.json',JSON.stringify(cache));}
 const result=cache[key];
 for(const edge of result.edges??[])edge.data.obstacleDetour=edge.data.routedPoints.length>2;
 return result;
};
const progress=message=>{console.log(message);writeFileSync(process.cwd()+'/.cache/prepare-progress.txt',message+'\n');};
for(const language of ['fr','en']) {
 presentation[language]={architectureScenes:{},decisionScenes:{}};
 for(const [collection,source]of Object.entries({architectureScenes,decisionScenes}))for(const [id,original]of Object.entries(source)){
  const translated=withLegend({...localize(original,language),language});
  const packed=id==='central'?packGovernanceScene(translated):packStudyScene(translated);
  if(id==='central'){
   presentation[language][collection][id]=packed;
   const projections=routes[language]={};
   for(const [key,ids]of [['overview',packed.overviewEdges],...ROUTED_NEEDS.map(n=>[n.id,n.highlight.edges])]){
    progress(`${language} central/${key}`);
    const input={...packed,edges:packed.edges.filter(e=>ids.includes(e.id))};
    const routed=cached(input,()=>routeScene(input));
    projections[key]=routed.edges;
   }
   projections.folded=[];
   const all=packed.groups.map(g=>g.id);
   const states=[all,...all.map(id=>[id]),...all.map(id=>all.filter(x=>x!==id))];
   // Root-only mixed views are common navigation states, not runtime route jobs.
   const roots=packed.groups.filter(g=>!g.parentId).map(g=>g.id);
   const nested=packed.groups.filter(g=>g.parentId).map(g=>g.id);
   for(let mask=1;mask<2**roots.length;mask++) {
    const ids=roots.filter((_,i)=>mask&(1<<i));
    states.push(ids,[...ids,...nested]);
   }
   for(let mask=1;mask<2**nested.length;mask++)states.push(nested.filter((_,i)=>mask&(1<<i)));
   // Default-first traversal, plus parent-only and fully expanded toggling.
   for(let i=1;i<all.length;i++)states.push(all.slice(i));
   for(const [key,edges]of Object.entries(projections).filter(([key])=>key!=='folded')) {
    const folds=key==='overview'?states:[all];
    for(const ids of folds){
     progress(`${language} ${key}/fold ${ids.join(',')}`);
     const input={...packed,projectionKey:key,detailedEdges:packed.edges,edges};
     const folded=cached({input,ids},()=>collapseGovernanceScene(input,ids,false));
     if(!projections.folded.some(p=>p.signature===folded.routingSignature))projections.folded.push({signature:folded.routingSignature,edges:folded.edges});
    }
   }
  }else {
   progress(`${language} ${collection}/${id}`);
   const routed=cached(packed,()=>routeScene(packed));
   const all=packed.groups.map(g=>g.id),preparedFolds=[];
   for(const ids of [all,...all.map(id=>[id]),...all.map(id=>all.filter(x=>x!==id))]){
    progress(`${language} ${id}/fold ${ids.join(',')}`);
    const folded=cached({input:packed,ids},()=>collapseGovernanceScene(packed,ids,false));
    preparedFolds.push({signature:folded.routingSignature,edges:folded.edges});
   }
   presentation[language][collection][id]={...routed,preparedFolds};
  }
  writeFileSync(process.cwd()+'/.cache/presentation-partial.json',JSON.stringify(presentation));
  writeFileSync(process.cwd()+'/.cache/routes-partial.json',JSON.stringify(routes));
 }
}
writeFileSync('src/governance-routes.json',JSON.stringify(routes)+'\n');
writeFileSync('src/presentation-scenes.json',JSON.stringify(presentation)+'\n');
progress('Prepared all FR/EN scenes, routes and fold states.');
