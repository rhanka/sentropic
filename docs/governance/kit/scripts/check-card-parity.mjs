import {chromium} from '/app/node_modules/playwright/index.mjs';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {portableName} from './portable-path.mjs';
const browser=await chromium.launch({args:['--no-sandbox']});
const report={cards:0,scenes:[],failures:[],maxSlotDeltaPx:0};
const snapshot=svg=>svg.evaluate(svg=>{
 svg.style.width=svg.width.baseVal.value+'px';svg.style.maxWidth='none';
 const scale=svg.getScreenCTM().a;
 return [...svg.querySelectorAll('[data-node]')].map(g=>{
  const card=g.querySelector('.service-node'),origin=card.getBoundingClientRect();
  const style=getComputedStyle(card);
  return {id:g.dataset.node,width:card.offsetWidth,height:card.offsetHeight,
   palette:[style.backgroundColor,style.color,style.borderRightColor,style.borderLeftColor],
   slots:[...card.querySelectorAll('.card-code,.service-name,.card-name,.card-detail,.repo-label')].map(e=>{
    const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return {text:e.textContent,font:[s.fontSize,s.lineHeight,s.fontWeight,s.fontFamily,s.color,s.letterSpacing],
     box:[r.x-origin.x,r.y-origin.y,r.width,r.height].map(n=>Math.round(n/scale*100)/100)};
   })};
 }).sort((a,b)=>a.id.localeCompare(b.id));
});
try {
 for(const language of ['fr','en']) {
  const context=await browser.newContext({viewport:{width:1920,height:1080},offline:true});
  const pages=await Promise.all([context.newPage(),context.newPage()]);
  for(const [i,page]of pages.entries()) {
   await page.goto('file://'+process.cwd()+(i ? '/dist/'+portableName : '/.cache/reference.html'));
   if(language==='en')await page.getByRole('button',{name:'English',exact:true}).click();
   await page.evaluate(()=>document.fonts.ready);
  }
  for(const id of ['central','annotate','ontologies','memory','traceability']) {
   const values=[];
   for(const page of pages) {
    await page.locator(`[data-gigogne-id="${id}"]`).click();
    const expand=page.locator('.architecture-figure').first().getByRole('button',{name:language==='fr'?'Tout déplier':'Expand all',exact:true}).first();
    if(await expand.count()&&await expand.isEnabled())await expand.click({timeout:1800});
    values.push(await snapshot(page.locator('.diagram-scroll .architecture-svg').first()));
   }
   report.cards+=values[1].length;
   try {
    // SVG transforms can put a 1/64 px coordinate on either rounding side.
    for(const [i,card]of values[1].entries())for(const [j,slot]of card.slots.entries()) {
     const expected=values[0][i].slots[j];
     for(const [k,value]of slot.box.entries()) {
      const delta=Math.abs(value-expected.box[k]);
      report.maxSlotDeltaPx=Math.max(report.maxSlotDeltaPx,delta);
      assert(delta<=.02,`${language}/${id}/${card.id}: slot geometry changed`);
     }
     slot.box=expected.box;
    }
    assert.deepEqual(values[1],values[0]);
   }
   catch(error) {report.failures.push({language,id,diff:error.message});}
   report.scenes.push({language,id,cards:values[1].length});
   if(id==='central')for(const count of [0,1,2]) {
    const inset=await pages[1].locator('[data-node] .service-node').first().evaluate((card,count)=>{
     for(const [i,line]of [...card.querySelector('.card-body').children].entries())line.textContent=i<count?'Fixture':'';
     const box=card.getBoundingClientRect(),footer=card.querySelector('.repo-label').getBoundingClientRect(),scale=box.height/200;
     return (box.bottom-footer.bottom)/scale-parseFloat(getComputedStyle(card).borderBottomWidth);
    },count);
    assert(Math.abs(inset-9.25)<.02,`Footer pin at ${count} body lines: ${inset}`);
   }
  }
  await context.close();
 }
}finally {writeFileSync('.cache/card-parity.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify({cards:report.cards,scenes:report.scenes.length,failures:report.failures.length}));
assert.equal(report.failures.length,0,'Validated card values, content, typography and slot geometry; see .cache/card-parity.json');
