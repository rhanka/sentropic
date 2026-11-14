import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { transform } from 'sucrase';
import { contentHeaders } from '/repo/packages/artifacts/src/content/headers.ts';

export function moduleFor(source: string, id: string, vapor = true) {
  const { descriptor, errors } = parse(source, { filename: `${id}.vue` });
  if (errors.length) throw errors[0];
  const script = compileScript(descriptor, { id, vapor, genDefaultAs: 'component' });
  const template = compileTemplate({ source: descriptor.template!.content, filename: `${id}.vue`, id, vapor,
    compilerOptions: { bindingMetadata: script.bindings } });
  if (template.errors.length) throw template.errors[0];
  return transform(`${script.content}\n${template.code}\ncomponent.render = render;
    component.__hmrId = '${id}';
    for (const name of ['setup','render']) if (component[name]) component[name] = window.wrap(component[name]);
    window.__VUE_HMR_RUNTIME__.createRecord('${id}', component);
    export default component;`, { transforms: ['typescript'] }).code;
}

export async function startHmrServer(source: string, vaporParent: boolean) {
  const sibling = '<script setup vapor>import {ref} from "vue"; const count=ref(0);</script><template><button id="sibling" @click="count++">{{count}}</button></template>';
  const parent = '<script setup>import Edited from "./edited.mjs"; import Sibling from "./sibling.mjs";</script><template><Edited/><Sibling/></template>';
  const modules = new Map([
    ['/edited.mjs', moduleFor(source, 'edited')],
    ['/sibling.mjs', moduleFor(sibling, 'sibling')],
    ['/parent.mjs', moduleFor(parent, 'parent', vaporParent)],
  ]);
  const imports = JSON.stringify({ imports: { vue: '/vue.mjs', 'vue/vapor': '/vue.mjs',
    '@sentropic/design-system-vue': '/node_modules/@sentropic/design-system-vue/dist/index.js',
    '@sentropic/design-system-themes': '/node_modules/@sentropic/design-system-themes/dist/index.js',
    '@sentropic/design-system-tokens': '/node_modules/@sentropic/design-system-tokens/dist/index.js',
    'lucide-vue-next': '/node_modules/lucide-vue-next/dist/esm/lucide-vue-next.js' } });
  const hash = `'sha256-${createHash('sha256').update(imports).digest('base64')}'`;
  const entry = `import {createApp,createVaporApp,vaporInteropPlugin,nextTick} from 'vue';
    window.marks=[]; let depth=0;
    window.wrap = fn => new Proxy(fn, {apply(target,self,args) {
      const outer=depth++===0; if(outer)window.marks.push(['f0',performance.now()]);
      try {return Reflect.apply(target,self,args)} finally {depth--;if(outer)window.marks.push(['f1',performance.now()])}
    }});
    const {default:Root}=await import('/parent.mjs');
    ${vaporParent ? 'createVaporApp' : 'createApp'}(Root).use(vaporInteropPlugin).mount('#app');
    window.replace=async(kind,url)=>{window.marks=[];window.marks.push(['request0',performance.now()]);
      const {default:next}=await import(url);
      const fetched=performance.getEntriesByName(new URL(url,location.href).href).at(-1);
      if(!fetched)throw Error('missing same-origin patch resource timing');
      window.marks.push(['p0',fetched.responseEnd]);window.marks.push(['p1',performance.now()]);
      window.marks.push(['r0',performance.now()]);
      if(kind==='rerender')__VUE_HMR_RUNTIME__.rerender('edited',next.render);else __VUE_HMR_RUNTIME__.reload('edited',next);
      await nextTick();window.marks.push(['r1',performance.now()]);window.marks.push(['p2',performance.now()]);return window.marks;
    };window.ready=true;`;
  modules.set('/entry.mjs', entry);
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname;
    try {
      let mime = 'text/javascript';
      let body: string | Buffer;
      if (path === '/') { mime = 'text/html'; body = `<div id="app"></div><script type="importmap">${imports}</script><script type="module" src="/entry.mjs"></script>`; }
      else if (modules.has(path)) body = modules.get(path)!;
      else if (path === '/vue.mjs') body = await readFile('/tools/node_modules/vue/dist/vue.runtime-with-vapor.esm-browser.js');
      else if (/^\/node_modules\/[\w@./-]+\.js$/.test(path) && !path.includes('..')) body = await readFile(`/tools${path}`);
      else throw Error('unlisted');
      res.writeHead(200, contentHeaders({ mimeType: mime, size: Buffer.byteLength(body), mode: 'application', scriptHashes: [hash] }));res.end(body);
    } catch (error) { res.writeHead(404);res.end(String(error)); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, modules, origin: `http://127.0.0.1:${(server.address() as {port:number}).port}` };
}
