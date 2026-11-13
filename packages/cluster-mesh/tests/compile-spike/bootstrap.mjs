import * as compiler from '@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js';
import { transform } from 'sucrase';

export function compile(source, kind = 'whole', vapor = true) {
  const { descriptor, errors } = compiler.parse(source, { filename: 'Fixture.vue' });
  if (errors.length) throw errors[0];
  const id = 'data-v-spike-fixture';
  const script = compiler.compileScript(descriptor, { id, inlineTemplate: false });
  const template = compiler.compileTemplate({
    source: descriptor.template.content, filename: 'Fixture.vue', id,
    scoped: descriptor.styles.some(style => style.scoped),
    slotted: descriptor.slotted,
    vapor,
    compilerOptions: { bindingMetadata: script.bindings },
  });
  if (template.errors.length) throw template.errors[0];
  const styles = descriptor.styles.map(style => compiler.compileStyle({
    source: style.content, filename: 'Fixture.vue', id, scoped: style.scoped,
  }));
  for (const style of styles) if (style.errors.length) throw style.errors[0];
  return {
    script: transform(script.content, { transforms: ['typescript'], filePath: 'Fixture.ts' }).code,
    template: template.code,
    styles: styles.map(style => style.code),
    bindings: script.bindings,
  };
}

globalThis.spike = { compile, compiler, transform };
