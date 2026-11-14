import * as compiler from '@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js';
import { transform } from 'sucrase';

export function createSession(vapor = true) {
  let previous = {};
  const counters = { script: 0, template: 0, style: 0 };
  return { counters, compile(source) {
  const { descriptor, errors } = compiler.parse(source, { filename: 'Fixture.vue' });
  if (errors.length) throw errors[0];
  const id = 'data-v-spike-fixture';
  // This spike's corpus has one imported component (Button). The production
  // implementation must derive the imported-binding set from compiler metadata.
  const scriptKey = JSON.stringify([descriptor.scriptSetup.content, descriptor.cssVars,
    /\bButton\b/.test(descriptor.template.content)]);
  let script = previous.script;
  if (previous.scriptKey !== scriptKey) {
    script = compiler.compileScript(descriptor, { id, inlineTemplate: false });
    script.stripped = transform(script.content, { transforms: ['typescript'], filePath: 'Fixture.ts' }).code;
    counters.script++;
  }
  const templateKey = JSON.stringify([descriptor.template.content, script.bindings,
    descriptor.styles.some(style => style.scoped), descriptor.slotted]);
  let template = previous.template;
  if (previous.templateKey !== templateKey) {
    template = compiler.compileTemplate({
    source: descriptor.template.content, filename: 'Fixture.vue', id,
    scoped: descriptor.styles.some(style => style.scoped),
    slotted: descriptor.slotted,
    vapor,
    compilerOptions: { bindingMetadata: script.bindings },
    });
    if (template.errors.length) throw template.errors[0];
    counters.template++;
  }
  const styleKeys = descriptor.styles.map(style => JSON.stringify([style.content, style.attrs]));
  const styles = descriptor.styles.map((style, index) => {
    if (style.module) throw Error('style modules refused by version 1');
    if (previous.styleKeys?.[index] === styleKeys[index]) return previous.styles[index];
    counters.style++;
    return compiler.compileStyle({ source: style.content, filename: 'Fixture.vue', id, scoped: style.scoped });
  });
  for (const style of styles) if (style.errors.length) throw style.errors[0];
  previous = { scriptKey, script, templateKey, template, styleKeys, styles };
  return {
    script: script.stripped,
    template: template.code,
    styles: styles.map(style => style.code),
    bindings: script.bindings,
  };
  } };
}

export function compile(source) { return createSession().compile(source); }
globalThis.spike = { compile, createSession, compiler, transform };
