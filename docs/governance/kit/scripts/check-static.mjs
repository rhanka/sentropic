import {chromium} from '/app/node_modules/playwright/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(readFileSync('../images/manifest.json'));
const browser=await chromium.launch({args:['--no-sandbox']});
const report={status:'pending',checks:[],errors:[]};
try {
  assert.equal(manifest.images.length,11);
  for(const theme of ['light','dark']){
    const context=await browser.newContext({viewport:{width:1200,height:900},colorScheme:theme,offline:true});
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    for(const image of manifest.images){
      const source=readFileSync('../images/'+image.file,'utf8');
      assert.equal(createHash('sha256').update(source).digest('hex'),image.sha256);
      assert(!/<script|<foreignObject|\bon\w+=/.test(source),'Script-free SVG');
      await page.goto('file://'+process.cwd()+'/../images/'+image.file);
      await page.evaluate(()=>document.fonts.ready);
      const result=await page.evaluate(()=>{
        const svg=document.querySelector('svg'),frame=svg.viewBox.baseVal;
        const failures=[];
        for(const card of svg.querySelectorAll('[data-static-card]')){
          const rect=card.querySelector('rect').getBBox();
          for(const text of card.querySelectorAll('text')){
            const b=text.getBBox();
            if(b.x<rect.x-1||b.y<rect.y-1||b.x+b.width>rect.x+rect.width+1||b.y+b.height>rect.y+rect.height+1)
              failures.push({card:card.dataset.staticCard,text:text.textContent});
          }
        }
        const style=getComputedStyle(svg);
        return {failures,width:frame.width,height:frame.height,groups:svg.querySelectorAll('[data-group]').length,
          edges:svg.querySelectorAll('[data-edge]').length,surface:style.getPropertyValue('--st-semantic-surface-raised').trim()};
      });
      assert.deepEqual(result.failures,[],image.file+' SVG text containment');
      if(image.file==='overview-en.svg'){assert.equal(result.groups,5);assert.equal(result.edges,10);}
      // Check the image embedding mode GitHub READMEs use, without inline HTML.
      const html='<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:16px;background:'+(theme==='dark'?'#0d1117':'#fff')+'}img{max-width:100%;height:auto;display:block}</style><img alt="Governance diagram" src="../../images/'+image.file+'">';
      writeFileSync('.cache/static-check.html',html);
      await page.goto('file://'+process.cwd()+'/.cache/static-check.html');
      assert(await page.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0),'SVG decodes as an image');
      for(const width of [1200,390]){
        await page.setViewportSize({width,height:900});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Embedded image fits '+width);
      }
      if(['overview-en.svg','frame-design-system-en.svg'].includes(image.file)){
        await page.setViewportSize({width:1200,height:900});
        await page.locator('img').screenshot({path:'.cache/static-'+theme+'-'+image.file.replace('.svg','.png')});
      }
      report.checks.push({file:image.file,theme,...result});
    }
    await context.close();
  }
  for(const image of manifest.images){
    const pair=report.checks.filter(c=>c.file===image.file);
    assert.notEqual(pair[0].surface,pair[1].surface,'SVG honors both themes');
  }
  assert.deepEqual(report.errors,[]);
  report.status='passed';
} finally {
  writeFileSync('.cache/static-review.json',JSON.stringify(report,null,2)+'\n');
  await browser.close();
}
console.log('Static SVG checks passed: 11 images × light/dark, embedding at 1200/390 px.');
