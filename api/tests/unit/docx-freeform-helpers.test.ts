import { describe, it, expect } from 'vitest';
import {
  doc,
  h,
  p,
  bold,
  italic,
  list,
  table,
  pageBreak,
  hr,
  getSandboxGlobals,
  type FreeformContext,
} from '../../src/services/docx-freeform-helpers';
import { Document, Packer, Paragraph, TextRun, Table } from 'docx';
import vm from 'node:vm';

const stubContext: FreeformContext = {
  entity: { id: 'test-entity', name: 'Test Entity' },
  initiatives: [{ id: 'init-1', data: { name: 'Initiative 1' } }],
  matrix: null,
  workspace: { id: 'test-workspace' },
};

describe('docx-freeform-helpers', () => {
  describe('doc()', () => {
    it('should return a Document instance', () => {
      const result = doc([p('Hello')]);
      expect(result).toBeInstanceOf(Document);
    });

    it('should produce a valid DOCX buffer via Packer', async () => {
      const result = doc([h(1, 'Title'), p('Body text')]);
      const buffer = await Packer.toBuffer(result);
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer.byteLength).toBeGreaterThan(0);
      // DOCX files start with PK (ZIP signature)
      expect(buffer[0]).toBe(0x50); // 'P'
      expect(buffer[1]).toBe(0x4b); // 'K'
    });
  });

  describe('h()', () => {
    it('should return a Paragraph instance', () => {
      const result = h(1, 'Heading');
      expect(result).toBeInstanceOf(Paragraph);
    });

    it('should clamp level between 1 and 6', () => {
      // Should not throw for edge cases
      expect(() => h(0, 'Too low')).not.toThrow();
      expect(() => h(7, 'Too high')).not.toThrow();
    });
  });

  describe('p()', () => {
    it('should return a Paragraph instance from string', () => {
      const result = p('Some text');
      expect(result).toBeInstanceOf(Paragraph);
    });
  });

  describe('bold() / italic()', () => {
    it('should return TextRun instances', () => {
      expect(bold('strong')).toBeInstanceOf(TextRun);
      expect(italic('emphasis')).toBeInstanceOf(TextRun);
    });
  });

  describe('list()', () => {
    it('should return an array of Paragraphs', () => {
      const result = list(['Item 1', 'Item 2', 'Item 3']);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(3);
      for (const item of result) {
        expect(item).toBeInstanceOf(Paragraph);
      }
    });
  });

  describe('table()', () => {
    it('should return a Table instance', () => {
      const result = table(['Col A', 'Col B'], [['1', '2'], ['3', '4']]);
      expect(result).toBeInstanceOf(Table);
    });
  });

  describe('pageBreak()', () => {
    it('should return a Paragraph instance', () => {
      expect(pageBreak()).toBeInstanceOf(Paragraph);
    });
  });

  describe('hr()', () => {
    it('should return a Paragraph instance', () => {
      expect(hr()).toBeInstanceOf(Paragraph);
    });
  });

  describe('getSandboxGlobals()', () => {
    it('should return an object with helpers, docx exports, and context', () => {
      const globals = getSandboxGlobals(stubContext);
      expect(typeof globals.doc).toBe('function');
      expect(typeof globals.h).toBe('function');
      expect(typeof globals.p).toBe('function');
      expect(typeof globals.bold).toBe('function');
      expect(typeof globals.italic).toBe('function');
      expect(typeof globals.list).toBe('function');
      expect(typeof globals.table).toBe('function');
      expect(typeof globals.pageBreak).toBe('function');
      expect(typeof globals.hr).toBe('function');
      // Raw docx classes
      expect(globals.Document).toBe(Document);
      expect(globals.Paragraph).toBe(Paragraph);
      expect(globals.TextRun).toBe(TextRun);
      expect(globals.Table).toBe(Table);
      // Context
      expect(globals.context).toBe(stubContext);
      // Safe built-ins
      expect(globals.Math).toBe(Math);
      expect(globals.JSON).toBe(JSON);
    });
  });

  describe('sandbox execution', () => {
    it('should execute freeform code and return a Document', async () => {
      const globals = getSandboxGlobals(stubContext);
      const sandbox = vm.createContext(globals);
      const code = `(function() {
        return doc([
          h(1, "Test Report"),
          p("This is a test document."),
          list(["Item A", "Item B"]),
          table(["Header"], [["Value"]]),
          pageBreak(),
          p("Second page."),
        ]);
      })()`;
      const result = new vm.Script(code).runInContext(sandbox, { timeout: 5000 });
      expect(result).toBeInstanceOf(Document);

      const buffer = await Packer.toBuffer(result);
      expect(buffer.byteLength).toBeGreaterThan(0);
    });

    it('should access context data in sandbox', () => {
      const globals = getSandboxGlobals(stubContext);
      const sandbox = vm.createContext(globals);
      const code = `(function() {
        const name = context.entity.name;
        return doc([h(1, name), p("Entity: " + context.entity.id)]);
      })()`;
      const result = new vm.Script(code).runInContext(sandbox, { timeout: 5000 });
      expect(result).toBeInstanceOf(Document);
    });

    it('should throw syntax error for invalid code', () => {
      const globals = getSandboxGlobals(stubContext);
      const sandbox = vm.createContext(globals);
      expect(() => {
        new vm.Script('(function() { return doc([ })()').runInContext(sandbox, { timeout: 5000 });
      }).toThrow();
    });

    it('should throw on timeout for infinite loops', () => {
      const globals = getSandboxGlobals(stubContext);
      const sandbox = vm.createContext(globals);
      const code = '(function() { while(true) {} })()';
      expect(() => {
        new vm.Script(code).runInContext(sandbox, { timeout: 100 });
      }).toThrow(/timed out/i);
    });

    it('should not have access to require or process', () => {
      const globals = getSandboxGlobals(stubContext);
      const sandbox = vm.createContext(globals);
      const code = '(function() { return typeof require })()';
      const result = new vm.Script(code).runInContext(sandbox, { timeout: 5000 });
      expect(result).toBe('undefined');

      const code2 = '(function() { return typeof process })()';
      const result2 = new vm.Script(code2).runInContext(sandbox, { timeout: 5000 });
      expect(result2).toBe('undefined');
    });
  });
});
