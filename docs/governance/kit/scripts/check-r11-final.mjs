import {chromium} from '/app/node_modules/playwright/index.mjs';
import {writeFileSync,readFileSync,mkdirSync,copyFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {portableName} from './portable-path.mjs';

// Mount before.html from ffcc25c20 at R11_FINAL_SHOTS_DIR before running.
const out='/r11-final-shots';
mkdirSync(out,{recursive:true});
copyFileSync(process.cwd()+'/dist/'+portableName,out+'/after.html');
for(const stage of ['before','after']) {

const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const report=[];
for(const width of [1440,1920]) {
 const context=await browser.newContext({viewport:{width,height:1080},offline:true});
 const page=await context.newPage(), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`file://${out}/${stage}.html`);
 const figure=page.locator('.architecture-figure').first();
 await figure.locator('.architecture-svg').waitFor();
 await page.evaluate(()=>document.fonts.ready);
 const measure=()=>page.evaluate(()=>{
  const selectors={view:'[data-need-id="all"]',tile:'[data-need-id]:not([data-need-id="all"])',tab:'[data-gigogne-id]',chip:'.mobile-frame-controls button',zoom:'.diagram-controls button',output:'.diagram-controls output span, .diagram-controls output',frame:'[data-group-toggle] button, .frame-control-face'};
  return Object.fromEntries(Object.entries(selectors).map(([k,s])=>{const el=document.querySelector(s),c=getComputedStyle(k==='output'?(el.querySelector('span')??el):el),r=el.getBoundingClientRect(),heights=(k==='output'?[el]:[...document.querySelectorAll(s)]).map(e=>e.getBoundingClientRect().height);return [k,{height:r.height,heightMin:Math.min(...heights),heightMax:Math.max(...heights),fontSize:c.fontSize,padding:c.padding,width:r.width,classes:el.getAttribute('class'),standardHeight:c.getPropertyValue('--st-component-button-anatomy-density-sm-controlHeight')}]}));
 });
 const row={width,controls:await measure(),states:{}};
 for(const state of ['collapsed','h2a','surfaces','expanded']) {
  if(state==='h2a') await figure.locator('[data-group-toggle="h2a"]').click();
  if(state==='surfaces') await figure.locator('[data-group-toggle="surfaces"]').click();
  if(state==='expanded') await figure.locator('.diagram-controls button').filter({hasText:'Tout déplier'}).click();
  await page.waitForFunction(()=>document.querySelector('.architecture-figure').getAttribute('aria-busy')==='false');
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  await figure.locator('.diagram-scroll').screenshot({path:`${out}/${stage}-${width}-${state}-canvas.png`});
  const clip=await page.evaluate(()=>{
   const region=document.querySelector('[aria-label="Sélecteur de besoins à router sur le diagramme central"]').getBoundingClientRect(),canvas=document.querySelector('.architecture-figure .diagram-scroll').getBoundingClientRect();
   return {x:region.x+scrollX,y:region.y+scrollY,width:region.width,height:canvas.bottom-region.top};
  });
  const full=await page.screenshot({fullPage:true});
  const cropped=await page.evaluate(async({src,clip})=>{
   const img=new Image();img.src=src;await img.decode();const c=document.createElement('canvas');c.width=Math.ceil(clip.width);c.height=Math.ceil(clip.height);c.getContext('2d').drawImage(img,clip.x,clip.y,clip.width,clip.height,0,0,c.width,c.height);return c.toDataURL().split(',')[1];
  },{src:'data:image/png;base64,'+full.toString('base64'),clip});
  writeFileSync(`${out}/${stage}-${width}-${state}-area.png`,Buffer.from(cropped,'base64'));
  if(state==='h2a'||state==='surfaces') await figure.locator(`[data-group="${state}"]`).screenshot({path:`${out}/${stage}-${width}-${state}-frame.png`});
  row.states[state]=await figure.evaluate(f=>{
   const svg=f.querySelector('.architecture-svg');
   return {viewBox:svg.getAttribute('viewBox'),scale:svg.getScreenCTM().a,
    geometry:[...svg.querySelectorAll('[data-node], [data-edge], .diagram-edge-pill, .diagram-group-box, .diagram-group-rule')].map(e=>e.outerHTML),
    groups:[...svg.querySelectorAll('[data-group]')].map(g=>({id:g.dataset.group,box:[...g.querySelector('.diagram-group-box').attributes].map(a=>[a.name,a.value]),text:[...g.querySelectorAll(':scope > text')].map(t=>({text:t.textContent,size:getComputedStyle(t).fontSize}))})),
    cards:[...svg.querySelectorAll('[data-node]')].map(n=>n.outerHTML),paths:[...svg.querySelectorAll('[data-edge] path')].map(p=>p.getAttribute('d')),
    headerMasks:[...svg.querySelectorAll('[data-group]')].map(g=>{const b=g.querySelector('.diagram-group-box');return {x:Number(b.getAttribute('x')),y:Number(b.getAttribute('y')),width:Number(b.getAttribute('width')),height:Math.max(150,...[...g.querySelectorAll(':scope > text')].map(t=>t.getBBox().y+t.getBBox().height-Number(b.getAttribute('y'))+12))};}),
    labelMasks:[...svg.querySelectorAll('.diagram-edge-pill')].map(g=>{const b=g.getBBox();return {x:b.x-4,y:b.y-4,width:b.width+8,height:b.height+8};})};
  });
  if(stage==='after') {
   const problems=await figure.evaluate(f=>[...f.querySelectorAll('[data-group-toggle]')].flatMap(c=>{
    const button=c.querySelector('button'),box=c.closest('[data-group]').querySelector('.diagram-group-box').getBoundingClientRect(),r=button?.getBoundingClientRect();
    return !r||!button.classList.contains('st-iconButton--sm')||!button.querySelector('svg')||r.left<box.left||r.top<box.top||r.right>box.right||r.bottom>box.bottom?[c.dataset.groupToggle]:[];
   }));
   assert.deepEqual(problems,[],`${width}/${state}: DS controls inside frames`);
  }
 }
 if(stage==='after') {
  for(const key of ['view','tile','tab','chip','zoom'])assert(row.controls[key].classes.includes('st-button--sm'),`${key}: DS sm`);
  const toggle=figure.locator('[data-group-toggle="surfaces"] button');
  await page.keyboard.press('Tab');await toggle.focus();assert(await toggle.evaluate(b=>b.matches(':focus-visible')),'Keyboard focus uses DS ring');
  await toggle.press('Space');await page.waitForFunction(()=>document.querySelector('.architecture-figure').getAttribute('aria-busy')==='false');
  assert.equal(await figure.locator('[data-group="surfaces"]').getAttribute('data-collapsed'),'true','Keyboard collapse');
 }
 row.errors=errors; report.push(row); await context.close();
}
writeFileSync(`${out}/${stage}.json`,JSON.stringify(report,null,2));
await browser.close();
console.log(stage,report.map(r=>({width:r.width,controls:r.controls,errors:r.errors})));

}
{

const before=JSON.parse(readFileSync(out+'/before.json')),after=JSON.parse(readFileSync(out+'/after.json'));
const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const results=[];
try { for(let i=0;i<before.length;i++){
 const b=before[i],a=after[i],width=b.width;
 const checks={width};
 for(const key of ['viewBox','scale','cards','paths']) {checks[key]=JSON.stringify(a.states.expanded[key])===JSON.stringify(b.states.expanded[key]);}
 checks.boxes=JSON.stringify(a.states.expanded.groups.map(g=>g.box))===JSON.stringify(b.states.expanded.groups.map(g=>g.box));
 const masks=[...b.states.expanded.headerMasks,...a.states.expanded.headerMasks,...b.states.expanded.labelMasks,...a.states.expanded.labelMasks];
 const imgs=[],pixelMasks=[];
 for(const stage of ['before','after']){
  const ctx=await browser.newContext({viewport:{width,height:1080},offline:true}),page=await ctx.newPage();
  await page.goto('file://'+out+'/'+stage+'.html');
  const fig=page.locator('.architecture-figure').first();await fig.locator('.architecture-svg').waitFor();
  await fig.locator('.diagram-controls button').filter({hasText:'Tout déplier'}).click();
  await page.waitForFunction(()=>document.querySelector('.architecture-figure').getAttribute('aria-busy')==='false');
  await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(requestAnimationFrame));
  // Align both isolated canvases to physical pixels; page controls have different heights.
  await fig.locator('.diagram-scroll').evaluate(el=>{
   const {width,height}=el.getBoundingClientRect();
   Object.assign(el.style,{position:'fixed',left:'0px',top:'0px',margin:'0px',width:width+'px',height:Math.ceil(height)+'px',backgroundColor:getComputedStyle(el.querySelector('svg')).backgroundColor,zIndex:'9999'});
  });
  pixelMasks.push(...await fig.locator('.architecture-svg').evaluate((svg,masks)=>{
   const m=svg.getScreenCTM(),r=svg.closest('.diagram-scroll').getBoundingClientRect();
   return masks.map(b=>{const x=Math.floor(b.x*m.a+m.e-r.left)-2,y=Math.floor(b.y*m.d+m.f-r.top)-2;return {x,y,width:Math.ceil((b.x+b.width)*m.a+m.e-r.left)-x+2,height:Math.ceil((b.y+b.height)*m.d+m.f-r.top)-y+2};});
  },masks));
  const png=await fig.locator('.diagram-scroll').screenshot();imgs.push(png.toString('base64'));await ctx.close();
 }
 const page=await browser.newPage();
 const diff=await page.evaluate(async({imgs,pixelMasks})=>{
  const canvases=[];
  for(const src of imgs){const img=new Image();img.src='data:image/png;base64,'+src;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);ctx.fillStyle='#ff00ff';for(const b of pixelMasks)ctx.fillRect(b.x,b.y,b.width,b.height);canvases.push(c);}
  const [a,b]=canvases;if(a.width!==b.width||a.height!==b.height)return {error:'Image dimensions changed'};
  const ad=a.getContext('2d').getImageData(0,0,a.width,a.height),bd=b.getContext('2d').getImageData(0,0,b.width,b.height),diff=a.getContext('2d').createImageData(a.width,a.height);let pixels=0;const points=[];
  for(let i=0;i<ad.data.length;i+=4){const changed=[0,1,2,3].some(k=>ad.data[i+k]!==bd.data[i+k]);if(changed){pixels++;if(points.length<20)points.push([i/4%a.width,Math.floor(i/4/a.width),[...ad.data.slice(i,i+4)],[...bd.data.slice(i,i+4)]]);}diff.data[i]=changed?255:0;diff.data[i+3]=255;}
  const masked=canvases.map(c=>c.toDataURL().split(',')[1]);a.getContext('2d').putImageData(diff,0,0);return {pixels,points,total:a.width*a.height,png:a.toDataURL().split(',')[1],masked};
 },{imgs,pixelMasks});
 if(diff.masked)for(const [i,stage] of ['before','after'].entries())writeFileSync(`${out}/${stage}-${width}-expanded-masked.png`,Buffer.from(diff.masked[i],'base64'));
 delete diff.masked;
 if(diff.png)writeFileSync(`${out}/diff-${width}-expanded.png`,Buffer.from(diff.png,'base64'));
 delete diff.png;checks.pixelDiff=diff;results.push(checks);await page.close();
 }
 writeFileSync(out+'/comparison.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
 for(const r of results){for(const key of ['viewBox','scale','cards','paths','boxes'])assert(r[key],r.width+': '+key);assert.equal(r.pixelDiff.pixels,0,r.width+': pixel difference outside authorized headers/labels');}
}finally{await browser.close();}

}
