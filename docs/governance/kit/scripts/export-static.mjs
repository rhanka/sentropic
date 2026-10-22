import { chromium } from '/app/node_modules/playwright/index.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { portableName } from './portable-path.mjs';
const browser=await chromium.launch({args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1920,height:1080},offline:true,colorScheme:'light'});
const page=await context.newPage();
const artifact=process.cwd()+'/dist/'+portableName;
try {
  await page.goto('file://'+artifact);
  await page.locator('.architecture-figure svg').first().waitFor();
  await page.getByRole('button',{name:'English',exact:true}).click();
  await page.evaluate(()=>document.fonts.ready);
  const tokens={};
  for(const theme of ['light','dark']){
    await page.emulateMedia({colorScheme:theme});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    tokens[theme]=await page.locator('.architecture-figure svg').first().evaluate(svg=>{
      const css=getComputedStyle(svg);
      return Object.fromEntries([...new Set([...svg.outerHTML.matchAll(/var\((--st-[\w-]+)/g)].map(m=>m[1]))].map(k=>[k,css.getPropertyValue(k).trim()]));
    });
  }
  await page.emulateMedia({colorScheme:'light'});
  const exportSvg=async (frameId=null)=>page.locator('.architecture-figure svg').first().evaluate((svg,{tokens,frameId})=>{
    const copy=svg.cloneNode(true), ns='http://www.w3.org/2000/svg';
    const make=(tag,attrs={})=>{const el=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;};
    const point=(x,y)=>new DOMPoint(x,y).matrixTransform(svg.getScreenCTM().inverse());
    const box=element=>{
      const r=element.getBoundingClientRect(),a=point(r.left,r.top),b=point(r.right,r.bottom);
      return {x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y};
    };
    // Freeze the browser-measured card text into SVG text, retaining every
    // precomputed card/edge coordinate. No foreignObject or script is exported.
    for(const fo of svg.querySelectorAll('foreignObject')){
      const clone=copy.querySelector(`[data-node="${fo.parentElement.dataset.node}"] foreignObject`);
      const g=make('g',{'data-static-card':fo.parentElement.dataset.node});
      const card=fo.querySelector('.service-node'),r=box(card);
      g.append(make('rect',{...r,fill:'var(--diagram-fill)',stroke:'var(--diagram-border)','stroke-width':2}));
      g.append(make('rect',{x:r.x,y:r.y,width:8,height:r.height,fill:'var(--diagram-border)'}));
      const icon=fo.querySelector('header > svg'),ir=box(icon),ic=icon.cloneNode(true);
      ic.setAttribute('x',ir.x);ic.setAttribute('y',ir.y);g.append(ic);
      for(const element of fo.querySelectorAll('.card-code,.service-name,.card-name,.card-detail,.repo-label')){
        const css=getComputedStyle(element),ctx=document.createElement('canvas').getContext('2d');
        ctx.font=`${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
        const metrics=ctx.measureText('Hg'),ascent=metrics.fontBoundingBoxAscent,descent=metrics.fontBoundingBoxDescent;
        for(const child of element.childNodes)if(child.nodeType===Node.TEXT_NODE&&child.textContent){
          const range=document.createRange();range.selectNodeContents(child);
          const rect=range.getBoundingClientRect(),p=point(rect.x,rect.y);
          const h=point(rect.x,rect.bottom).y-p.y;
          const text=make('text',{x:p.x,y:p.y+h*ascent/(ascent+descent),
            'font-size':parseFloat(css.fontSize),'font-family':css.fontFamily,'font-weight':css.fontWeight,
            'letter-spacing':css.letterSpacing,fill:element.matches('.card-code,.card-detail')?'var(--diagram-muted)':'var(--st-semantic-text-primary)'});
          text.textContent=child.textContent;g.append(text);
        }
      }
      const rule=box(fo.querySelector('.card-rule'));
      g.append(make('rect',{...rule,fill:'var(--st-semantic-border-subtle)'}));
      clone.replaceWith(g);
    }
    copy.querySelectorAll('[data-group-toggle]').forEach(el=>el.remove());
    if(frameId){
      const entries=[...copy.querySelectorAll('[data-group],[data-node]')];
      const parents=new Map(entries.map(e=>[e.dataset.group??e.dataset.node,e.dataset.parent]));
      const within=id=>id===frameId||(parents.get(id)&&within(parents.get(id)));
      entries.filter(e=>!within(e.dataset.group??e.dataset.node)).forEach(e=>e.remove());
      for(const edge of copy.querySelectorAll('[data-edge]'))if(!within(edge.dataset.source)||!within(edge.dataset.target)){
        copy.querySelector(`[data-label-for="${edge.dataset.edge}"]`)?.remove();edge.remove();
      }
      const bounds=[...svg.querySelectorAll('[data-group],[data-node],[data-edge],[data-label-for]')]
        .filter(e=>e.dataset.group?within(e.dataset.group):e.dataset.node?within(e.dataset.node):e.dataset.edge?!!copy.querySelector(`[data-edge="${e.dataset.edge}"]`):!!copy.querySelector(`[data-label-for="${e.dataset.labelFor}"]`))
        .map(e=>e.getBBox());
      const x=Math.min(...bounds.map(r=>r.x))-20,y=Math.min(...bounds.map(r=>r.y))-20;
      const w=Math.max(...bounds.map(r=>r.x+r.width))-x+20,h=Math.max(...bounds.map(r=>r.y+r.height))-y+20;
      copy.setAttribute('viewBox',`${x} ${y} ${w} ${h}`);
      copy.setAttribute('width',w);copy.setAttribute('height',h);
    }
    const declarations=theme=>Object.entries(tokens[theme]).map(([k,v])=>`${k}:${v};`).join('');
    const theme=make('style');
    theme.textContent=`:root{${declarations('light')}}@media(prefers-color-scheme:dark){:root{${declarations('dark')}}}`;
    copy.prepend(theme);
    const [x,y,width,height]=copy.getAttribute('viewBox').split(' ').map(Number);
    const background=make('rect',{x,y,width,height,fill:'var(--st-semantic-surface-raised)'});
    copy.insertBefore(background,copy.querySelector('[data-group]'));
    copy.setAttribute('role','img');copy.removeAttribute('tabindex');
    return new XMLSerializer().serializeToString(copy);
  },{tokens,frameId});
  const records=[];
  const save=(name,svg)=>{if(/<foreignObject|<script|https?:\/\/(?!www.w3.org)/.test(svg))throw Error('Non-static SVG '+name);writeFileSync('../images/'+name,svg+'\n');records.push({file:name,sha256:createHash('sha256').update(svg+'\n').digest('hex')});};
  save('overview-en.svg',await exportSvg());
  const figure=page.locator('.architecture-figure').first();
  await figure.getByRole('button',{name:'Expand all',exact:true}).click();
  await page.evaluate(()=>document.fonts.ready);
  const frames=await figure.locator('.diagram-scroll [data-group]').evaluateAll(gs=>gs.map(g=>g.dataset.group));
  for(const id of frames)save(`frame-${id}-en.svg`,await exportSvg(id));
  writeFileSync('../images/manifest.json',JSON.stringify({portableSha256:createHash('sha256').update(readFileSync(artifact)).digest('hex'),geometry:'kit/src/presentation-scenes.json + governance-routes.json + governance-summary-layouts.json',frames,images:records},null,2)+'\n');
  console.log(`Static SVG export: overview and ${frames.length} frames; no scripts or foreignObject.`);
} finally {await browser.close();}
