import { nodeContent, groupContent } from './architecture-layout.js';
import { CARD_WIDTH, COLLAPSED_CARD_HEIGHT } from './governance-layout.js';

// Keep the study's original row order and containment while using the same
// measured dossier cards as the central diagram in either language.
export function packStudyScene(scene, collapsedIds = []) {
  const collapsed = new Set(collapsedIds);
  const entries = new Map([...scene.groups, ...scene.nodes].map(item => [item.id, structuredClone(item)]));
  const groups = new Set(scene.groups.map(group => group.id));
  const rowGap = 240, pad = 16;
  function measure(item) {
    if (!groups.has(item.id)) {
      item.data = {...item.data, fontScale:12/7, cardIcon:item.data.tone === 'identity' ? 'shield' : 'window',
        kicker:item.data.kind === 'store' ? (scene.language === 'en' ? 'STORAGE' : 'STOCKAGE') : (scene.language === 'en' ? 'COMPONENT' : 'COMPOSANT'),
        cardFooter:entries.get(item.parentId)?.cardFooter ?? entries.get(item.parentId)?.title ?? scene.title, cardTier:'service', layoutWidth:CARD_WIDTH};
      delete item.data.layoutHeight;
      const content=nodeContent(item.data);
      item.width=content.width; item.height=content.height; item.data.text=content.text;
      return {item, width:item.width, height:item.height, setHeight(h){this.height=item.height=h;}, place(x,y){item.position={x,y};item.data.layoutHeight=item.height;}};
    }
    item.collapsed = collapsed.has(item.id);
    if (item.collapsed) {
      item.width = CARD_WIDTH; item.height = COLLAPSED_CARD_HEIGHT;
      Object.assign(item, groupContent(item, item.width, true));
      return {item,width:item.width,height:item.height,place(x,y){item.position={x,y};}};
    }
    const children = item.legendEntries ? {width:CARD_WIDTH,height:item.legendEntries.length*64,place(){}}
      : layout([...entries.values()].filter(child=>child.parentId===item.id));
    item.width = Math.max(CARD_WIDTH, children.width + pad*2);
    Object.assign(item,groupContent(item,item.width));
    item.height=item.headerHeight+children.height+16;
    return {item,width:item.width,height:item.height,setHeight(h){this.height=item.height=h;},place(x,y){item.position={x,y};children.place(x+pad,y+item.headerHeight);}};
  }
  function layout(items) {
    const rows=[];
    for(const item of [...items].sort((a,b)=>a.position.y-b.position.y||a.position.x-b.position.x)) {
      let row=rows.find(row=>Math.abs(row.y-item.position.y)<12);
      if(!row) rows.push(row={y:item.position.y,items:[]});
      row.items.push(item);
    }
    for(const row of rows) {
      row.items=row.items.sort((a,b)=>a.position.x-b.position.x).map(measure);
      row.width=row.items.reduce((n,item)=>n+item.width,0)+Math.max(0,row.items.length-1)*rowGap;
      row.height=Math.max(0,...row.items.map(item=>item.height));
    }
    const width=Math.max(0,...rows.map(row=>row.width)),height=rows.reduce((n,row)=>n+row.height,0)+Math.max(0,rows.length-1)*rowGap;
    return {width,height,rows,place(x,y){for(const row of rows){row.placedY=y;let next=x+(width-row.width)/2;for(const item of row.items){item.place(next,y);next+=item.width+rowGap;}y+=row.height+rowGap;}}};
  }
  const roots=layout([...entries.values()].filter(item=>!entries.has(item.parentId)));
  roots.place(0,72);
  const visible = item => {
    for (let parent=item.parentId; entries.has(parent); parent=entries.get(parent).parentId) if (collapsed.has(parent)) return false;
    return true;
  };
  const bands=scene.bands.map(band=>{
    const row=roots.rows.find(row=>row.y>=band.y)??roots.rows.at(-1);
    return {...band,x:0,y:row.placedY-28,fontSize:24};
  });
  return {...scene,groups:scene.groups.map(g=>entries.get(g.id)).filter(visible),nodes:scene.nodes.map(n=>entries.get(n.id)).filter(visible),bands,
    edges:scene.edges.map(edge=>({...edge,data:{labelFontSize:21,pillLabel:true,marker:edge.data?.marker}}))};
}
