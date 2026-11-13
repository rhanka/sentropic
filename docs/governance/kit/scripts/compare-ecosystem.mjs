import { chromium } from '/app/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { renderCardSvgFromPresentation, renderZoneSvgFromPresentation } from '@sentropic/design-system-svelte/diagram-render';
import { measure } from '../src/ecosystem-measure.js';
import { dossierBoldFont } from '../src/hrpolnav-card-font.js';

// This preflight preserves the origin/main geometry verbatim. Refused DS
// cards are explicit diagnostic placeholders, never deliverable SVGs.
const out = '.cache/ecosystem-compare';
const owners = {
  'h2a-roles': ['h2a', '@sentropic/h2a', 'function', 'people'],
  'h2a-focus': ['h2a', '@sentropic/focus', 'lib', 'document'],
  'h2a-track': ['h2a', '@sentropic/track', 'cli', 'map'],
  'h2a-agent': ['h2a', '@sentropic/h2a', 'cli', 'robot'],
  'surf-ai': ['sentropic', '@sentropic/llm-mesh', 'lib', 'llm'],
  'surf-cowork': ['sentropic', '@sentropic/cowork-desktop', 'service', 'workstation'],
  'surf-cli': ['h2a', '@sentropic/h2a-cli', 'cli', 'workstation'],
  'surf-cloud': ['sentropic', 'sentropic-ui', 'service', 'web'],
  'cm-apis': ['sentropic', 'sentropic-api', 'service', 'api'],
  'cm-workflow': ['sentropic', 'sentropic-api', 'function', 'robot'],
  'mcp-comments': ['sentropic', '@sentropic/cluster-mesh', 'function', 'link'],
  'mcp-tools': ['sentropic', '@sentropic/cluster-mesh', 'function', 'join'],
  'mcp-connectors': ['sentropic', '@sentropic/mcp-broker', 'lib', 'network'],
  'cat-ai': ['sentropic', '@sentropic/llm-gateway', 'lib', 'llm'],
  'cat-resources': ['sentropic', '@sentropic/skills', 'lib', 'robot'],
  'cat-ui': ['sentropic', '@sentropic/chat-ui', 'lib', 'window'],
  'store-models': ['sentropic', '@sentropic/cluster-mesh', 'lib', 'postgres'],
  'store-artifacts': ['sentropic', '@sentropic/artifacts', 'lib', 'document'],
  'sec-access': ['sentropic', '@sentropic/cluster-mesh', 'function', 'shield'],
  'sec-observe': ['sentropic', 'sentropic-api', 'function', 'check'],
  'cluster-instances': ['sentropic', '@sentropic/cluster-mesh', 'lib', 'cluster'],
  'cluster-infra': ['sentropic', '@sentropic/artifacts', 'function', 'cloud'],
  'eng-memory': ['engram', '@sentropic/engram', 'lib', 'brain'],
  'eng-ontologies': ['engram', '@sentropic/engram', 'function', 'graph'],
  'ds-annotations': ['design-system', '@sentropic/design-system-svelte', 'function', 'document'],
  'ds-diagram': ['design-system', '@sentropic/diagram-canvas', 'lib', 'graph'],
  'ds-dossier': ['design-system', '@sentropic/design-system-svelte', 'function', 'document'],
  'ds-components': ['design-system', '@sentropic/design-system-svelte', 'lib', 'window'],
};
const nature = {lib:'PACKAGE',cli:'EXECUTION',service:'EXECUTION',store:'STORAGE',function:'CAPABILITY'};
const browser = await chromium.launch({args:['--no-sandbox']});
const page = await browser.newPage({colorScheme:'light'});
const report = {baseline:readFileSync(out+'/baseline.txt','utf8').trim(),version:'0.40.0',status:'pending',images:[],diagnostics:[]};
try {
  for (const file of readdirSync(out).filter(name=>/^old-.*\.svg$/.test(name)).sort()) {
    await page.goto('file://'+process.cwd()+'/'+out+'/'+file);
    await page.evaluate(()=>document.fonts.ready);
    const source = await page.evaluate(()=>{
      const svg=document.querySelector('svg');
      const entries=[...svg.querySelectorAll('[data-group],[data-node]')].map(g=>{
        const card=g.querySelector('[data-static-card]');
        const rect=(card??g).querySelector('rect');
        const box=Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(rect.getAttribute(k))]));
        const content=t=>t?.querySelector('tspan')
          ? [...t.querySelectorAll('tspan')].map(s=>s.textContent).join(' ') : t?.textContent;
        const lines=card?[...card.querySelectorAll(':scope > text')]:[];
        const slots=lines.slice(1,-1),bold=t=>Number(t.getAttribute('font-weight'))>=600;
        const secondary=t=>(t.getAttribute('fill')??'').includes('muted');
        const join=items=>items.map(content).join(' ');
        const texts=card?[content(lines[0]),join(slots.filter(bold)),
          join(slots.filter(t=>!bold(t)&&!secondary(t))),join(slots.filter(t=>!bold(t)&&secondary(t))),content(lines.at(-1))]:[
          content(g.querySelector(':scope > .diagram-kicker'))??(g.dataset.group==='surfaces'?'ACCESS':'REPOSITORY'),
          content(g.querySelector(':scope > text:not(.diagram-detail):not(.diagram-kicker)')),
          content(g.querySelector(':scope > .diagram-detail'))];
        return {id:g.dataset.node??g.dataset.group,kind:card?'card':'zone',collapsed:g.dataset.collapsed==='true',box,texts};
      });
      return {entries,edges:svg.querySelectorAll('[data-edge]').length,icons:svg.querySelectorAll('.diagram-icon').length,
        routes:[...svg.querySelectorAll('[data-edge],[data-label-for]')].map(e=>e.outerHTML),
        cards:svg.querySelectorAll('[data-node],[data-group][data-collapsed="true"]').length,bbox:svg.getAttribute('viewBox')};
    });
    const replacements=[];
    for (const entry of source.entries) {
      const {id,box,texts}=entry;
      let props,result;
      if (entry.kind==='card') {
        if (!owners[id]) throw Error('Unmapped original card '+id);
        const [repo,pkg,kind,icon]=owners[id];
        props={entityId:id,kicker:`${nature[kind]} · ${kind.toUpperCase()}`,title:texts[1],body:texts.slice(2,-1),
          detailCount:1,footer:`repo: ${repo} · ${pkg}`,icon};
        if(id==='surf-cli')props.body=['Deprecated relay → @sentropic/h2a','harness: sentropic repo'];
        if(id==='eng-memory')props.body=['Library + MCP memory service','Host-provisioned Postgres'];
        if(id==='h2a-track')props.body=['track CLI + track-mcp','Each consumer repo owns .track/'];
        if(id==='cat-ai')props.body=['llm-gateway: routing library','apps/llm-gateway: service'];
        result=renderCardSvgFromPresentation({form:'card',icon,text:{kicker:props.kicker,title:props.title,
          body:props.body[0],detail:props.body[1],footer:props.footer}},{entityId:id,measure}).result;
      } else {
        const icon=id==='engram'?'brain':id==='h2a'?'people':id==='design-system'?'window':'cluster';
        const repo={h2a:'h2a','cluster-mesh':'sentropic',engram:'engram','design-system':'design-system'}[id];
        props={entityId:id,kicker:repo??texts[0],title:repo?texts[1].replace(/^[^·]+ · /,''):texts[1],subtitle:texts[2],icon,
          collapsed:entry.collapsed,toggleLabel:entry.collapsed?'Expand':'Collapse',width:box.width,height:box.height};
        result=renderZoneSvgFromPresentation({form:'container',icon,text:{kicker:props.kicker,title:props.title,
          subtitle:props.subtitle}},{...props,measure}).result;
      }
      report.diagnostics.push(...result.diagnostics.map(d=>({file:file.slice(4),...d})));
      replacements.push({id,box,svg:result.kind==='rendered'?result.svg:null,diagnostics:result.diagnostics});
    }
    const candidate=await page.evaluate(({replacements,font})=>{
      const svg=document.querySelector('svg'),ns=svg.namespaceURI;
      // The old CSS is retained only for unchanged edges/labels. Card anatomy
      // is emitted exclusively by the published DS renderer.
      const style=document.createElementNS(ns,'style');
      style.textContent=`@font-face{font-family:'Ecosystem Inter';src:url('${font}');font-weight:100 900}svg{--st-font-sans:'Ecosystem Inter'}`;
      svg.prepend(style);
      for(const {id,box,svg:markup,diagnostics}of replacements){
        const old=svg.querySelector(`[data-node="${id}"],[data-group="${id}"]`);
        const g=document.createElementNS(ns,'g');
        g.setAttribute('transform',`translate(${box.x} ${box.y})`);
        if(markup){g.append(new DOMParser().parseFromString(markup,'image/svg+xml').documentElement);}
        else {
          g.setAttribute('data-refused',id);
          const rect=document.createElementNS(ns,'rect');
          for(const[k,v]of Object.entries({width:box.width,height:box.height,fill:'#fff4f4',stroke:'#c00'}))rect.setAttribute(k,v);
          const text=document.createElementNS(ns,'text');text.setAttribute('x','16');text.setAttribute('y','36');text.setAttribute('font-size','20');
          text.textContent=`REFUSED: ${id} (${diagnostics.map(d=>d.slot).join(', ')})`;g.append(rect,text);
        }
        old.replaceChildren(g);
      }
      return {svg:new XMLSerializer().serializeToString(svg),icons:svg.querySelectorAll('[data-diagram-icon]').length,
        cards:svg.querySelectorAll('.st-diagramCard,.st-diagramZone--collapsed').length,edges:svg.querySelectorAll('[data-edge]').length,
        routes:[...svg.querySelectorAll('[data-edge],[data-label-for]')].map(e=>e.outerHTML),
        refused:svg.querySelectorAll('[data-refused]').length,bbox:svg.getAttribute('viewBox')};
    },{replacements,font:dossierBoldFont});
    writeFileSync(out+'/new-'+file.slice(4),candidate.svg+'\n');
    if(JSON.stringify(source.routes)!==JSON.stringify(candidate.routes))throw Error('Changed original edge/label '+file);
    const area=bbox=>{const [, ,w,h]=bbox.split(' ').map(Number);return w*h;};
    report.images.push({file:file.slice(4),oldCards:source.cards,newCards:candidate.cards,oldEdges:source.edges,newEdges:candidate.edges,
      oldIcons:source.icons,newIcons:candidate.icons,refused:candidate.refused,
      oldBBox:source.bbox,newBBox:candidate.bbox,bboxRatio:area(candidate.bbox)/area(source.bbox),routesIdentical:true});
  }
} finally {await browser.close();}
if(!report.images.length)throw Error('No origin/main SVGs found');
report.status=report.diagnostics.length?'blocked':'passed';
writeFileSync(out+'/metrics.json',JSON.stringify(report,null,2)+'\n');
const rows=report.images.map(r=>`<tr><td>${r.file}</td><td>${r.oldCards} → ${r.newCards}</td><td>${r.oldEdges} → ${r.newEdges}</td><td>${r.oldIcons} → ${r.newIcons}</td><td>${r.bboxRatio}</td><td>${r.refused}</td></tr>`).join('');
writeFileSync(out+'/compare.html',`<!doctype html><meta charset="utf-8"><title>Ecosystem DS preflight</title><style>:root{color-scheme:light}body{font:16px system-ui;background:white;color:#172033;margin:24px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{width:100%;border:1px solid #ccd}th,td{text-align:left;padding:8px}pre{white-space:pre-wrap}</style><h1>Ecosystem: origin/main / DS 0.40.0 preflight</h1><p>Status: ${report.status}. Red REFUSED boxes are diagnostic placeholders, not standard cards or deliverable images. All original coordinates, edge paths and labels are retained.</p><table><tr><th>Image</th><th>Cards old → new</th><th>Edges old → new</th><th>Icons old → new</th><th>BBox ratio</th><th>Refusals</th></tr>${rows}</table>${report.images.map(r=>`<h2>${r.file}</h2><div class="pair"><div>Origin/main<img src="old-${r.file}"></div><div>DS candidate (diagnostic)<img src="new-${r.file}"></div></div>`).join('')}<h2>Diagnostics</h2><pre>${JSON.stringify(report.diagnostics,null,2).replaceAll('&','&amp;').replaceAll('<','&lt;')}</pre>`);
console.log(JSON.stringify({status:report.status,images:report.images.length,diagnostics:report.diagnostics.length}));
const preview=await chromium.launch({args:['--no-sandbox']});
try {
  const p=await preview.newPage({viewport:{width:1920,height:1080},colorScheme:'light'});
  await p.goto('file://'+process.cwd()+'/'+out+'/compare.html');
  await p.evaluate(()=>document.fonts.ready);
  await p.locator('.pair').last().screenshot({path:out+'/overview-comparison.png'});
  await p.locator('.pair').nth(8).screenshot({path:out+'/h2a-comparison.png'});
} finally {await preview.close();}
