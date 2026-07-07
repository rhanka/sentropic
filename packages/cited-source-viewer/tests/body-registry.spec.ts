import { afterEach, describe, expect, it } from "vitest";

import {
  getBodyRenderer,
  registerBodyRenderer,
  registeredBodyKinds,
  unregisterBodyRenderer,
  type CitedSourceBodyComponent,
} from "../src/bodies/registry.js";

/**
 * The body-renderer seam ("one UX, many bodies"): v2 (docx/pptx) and v3
 * (image-bbox) bodies must be able to plug in — and consumers to override a
 * v1 body — WITHOUT touching the frame. The registry is that seam; the frame
 * consults it before its built-ins.
 */
describe("bodies/registry", () => {
  const fakeBody = (() => {}) as unknown as CitedSourceBodyComponent;

  afterEach(() => {
    for (const kind of registeredBodyKinds()) unregisterBodyRenderer(kind);
  });

  it("registers and resolves a renderer by payload kind (v2/v3 plug-in path)", () => {
    expect(getBodyRenderer("docx")).toBeNull();
    registerBodyRenderer("docx", fakeBody);
    expect(getBodyRenderer("docx")).toBe(fakeBody);
    expect(registeredBodyKinds()).toContain("docx");
  });

  it("supports overriding an already-registered kind (consumer swap)", () => {
    const other = (() => {}) as unknown as CitedSourceBodyComponent;
    registerBodyRenderer("markdown", fakeBody);
    registerBodyRenderer("markdown", other);
    expect(getBodyRenderer("markdown")).toBe(other);
  });

  it("unregister removes the explicit registration", () => {
    registerBodyRenderer("image", fakeBody);
    unregisterBodyRenderer("image");
    expect(getBodyRenderer("image")).toBeNull();
  });

  it("rejects empty kinds", () => {
    expect(() => registerBodyRenderer("", fakeBody)).toThrow();
  });
});
