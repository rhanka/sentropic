import ELK from './vendor/elk.bundled.cjs';
import {writeFileSync} from 'node:fs';
import {buildGovernanceCentral} from '../src/governance-central.js';
import {aggregateTopLevel} from '../src/governance-summary.js';
import {groupContent,frameHeaderContent} from '../src/architecture-layout.js';
import {CARD_WIDTH,COLLAPSED_CARD_HEIGHT} from '../src/governance-layout.js';
import {routeScene} from '../src/architecture-routing.js';
import {localize} from '../src/governance-input.js';
import {withLegend} from '../src/governance-legend.js';
const elk=new ELK();
const layouts={};
for(const language of ['fr','en']){
 const original={...localize(buildGovernanceCentral(),language),language};
 const edges=aggregateTopLevel(original);
 const roots=original.groups.filter(g=>!g.parentId).map(g=>{
  const width=CARD_WIDTH;
  const header=frameHeaderContent({...g,collapsed:true},width);
  return {...g,width,...groupContent(g,width,true),...header,height:COLLAPSED_CARD_HEIGHT,collapsed:true};
 });
 let previous;
 for(let pass=0;pass<3;pass++){
  const graph={id:'root',layoutOptions:{'elk.algorithm':'layered','elk.direction':'RIGHT','elk.edgeRouting':'ORTHOGONAL','elk.spacing.nodeNode':'32','elk.layered.spacing.nodeNodeBetweenLayers':'64','elk.spacing.edgeEdge':'64','elk.layered.spacing.edgeEdgeBetweenLayers':'64','elk.spacing.portPort':'32','elk.layered.mergeEdges':'false'},children:roots.map(g=>({id:g.id,width:g.width,height:g.height,layoutOptions:{'elk.portConstraints':pass===2?'FIXED_POS':'FIXED_SIDE','elk.portAlignment.default':'CENTER','elk.spacing.portPort':'32'},ports:edges.flatMap(e=>['source','target'].filter(end=>e[end]===g.id).map(end=>{
    const other=previous?.children.find(n=>n.id===e[end==='source'?'target':'source']),self=previous?.children.find(n=>n.id===g.id);
    const side=other?(other.x>self.x?'EAST':'WEST'):(end==='source'?'EAST':'WEST');
    const id=e.id+':'+end;
    const bank=pass===2?self.ports.filter(p=>p.properties['port.side']===side).sort((a,b)=>a.y-b.y):[];
    const portGap=Math.min(32,(g.height-32)/Math.max(1,bank.length-1));
    return {id,width:0,height:0,properties:{'port.side':side},...(pass===2?{x:side==='EAST'?g.width:0,y:g.height/2+(bank.findIndex(p=>p.id===id)-(bank.length-1)/2)*portGap}:{})};
  }))})),edges:edges.map(e=>({id:e.id,sources:[e.id+':source'],targets:[e.id+':target'],labels:[{text:e.label,width:240,height:56}]}))};
  graph.layoutOptions['elk.spacing.edgeNode']='32';
  graph.layoutOptions['elk.layered.spacing.edgeNodeBetweenLayers']='32';
  previous=await elk.layout(graph);
 }
 const groups=roots.map(g=>({...g,position:{x:previous.children.find(n=>n.id===g.id).x,y:previous.children.find(n=>n.id===g.id).y}}));
 // Keep the two responsibility rows level and their column gaps uniform.
 for(const ids of [['h2a','surfaces'],['engram','design-system']]){
  const row=groups.filter(g=>ids.includes(g.id));
  const y=(ids[0]==='h2a'?Math.min:Math.max)(...row.map(g=>g.position.y));
  for(const group of row)group.position.y=y;
 }
 const scene=routeScene({...original,projectionKey:"overview",nodes:groups,groups,edges});
 const legend=withLegend(scene).groups.at(-1);
 Object.assign(legend,{width:CARD_WIDTH,height:COLLAPSED_CARD_HEIGHT,collapsed:true},groupContent(legend,CARD_WIDTH,true));
 layouts[language]={groups:[...scene.groups,legend],edges:scene.edges};
 console.log(language,{width:previous.width,height:previous.height,points:scene.edges.map(e=>({id:e.id,points:e.data.routedPoints}))});
}
writeFileSync(new URL('../src/governance-summary-layouts.json',import.meta.url),JSON.stringify(layouts)+'\n');
