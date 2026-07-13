import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import CitedSourceViewer from "../src/CitedSourceViewer.svelte";
import type {
  CitedSourceGroup,
  CitedSourceRef,
  SourcePayload,
  SourcePayloadBase,
} from "../src/types.js";

/**
 * Frame tests for the canonical S.6 UX — markdown body path (mounts fully in
 * jsdom; the PDF body's logic is covered by the pure engine tests — pdf.js
 * itself never loads in jsdom). Ports the qualified graphify interim suite and
 * extends it with the S.6 extended API: grouped thread, scope toggle, entity
 * navigator, focus events, and REAL-DS-component presence.
 */

const REFS: CitedSourceRef[] = [
  {
    rawRef: "corpus/blue-study.md",
    section: "Chapter 2",
    excerpt: "the coronet had vanished from his private safe",
  },
  {
    rawRef: "corpus/blue-study.md",
    section: "Chapter 1",
    excerpt: "Holmes examined the ledger in silence",
  },
];

const SOURCE_TEXT =
  "# The Adventure of the Blue Study\n\n" +
  "Holmes examined the ledger in silence.\n\n" +
  "## Chapter 2\n\n" +
  "The banker confessed that the coronet had vanished from his private safe during the night.";

const NOTES_TEXT = "# Notes\n\nHere is a passage from the second document indeed.";

function mdResolver() {
  return vi.fn(
    async (r: CitedSourceRef): Promise<SourcePayload> =>
      r.rawRef === "corpus/notes.md"
        ? { kind: "markdown", text: NOTES_TEXT }
        : { kind: "markdown", text: SOURCE_TEXT },
  );
}

async function settle() {
  // Let the $effect-driven async load resolve and the DOM update.
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

let host: HTMLDivElement | null = null;
let instance: Record<string, unknown> | null = null;
afterEach(() => {
  if (instance) unmount(instance);
  instance = null;
  host?.remove();
  host = null;
});

function mountViewer(props: Record<string, unknown>): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  instance = mount(CitedSourceViewer, { target: host, props }) as Record<string, unknown>;
  flushSync();
  return host;
}

function buttonByLabel(el: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label,
  ) as HTMLButtonElement | undefined;
}

function scopeButton(el: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [
    ...el.querySelectorAll(
      ".st-contentSwitcher__option, .st-contentSwitcher [role='tab'], .st-contentSwitcher button",
    ),
  ].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
}

async function pressKey(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  flushSync();
  await settle();
}

describe("CitedSourceViewer (markdown body path)", () => {
  it("renders refs, resolves the source and highlights the active quote", async () => {
    const resolveSource = mdResolver();
    const el = mountViewer({
      refs: REFS,
      resolveSource,
      activeIndex: 0,
      title: "corpus/blue-study.md",
      class: "host-overlay",
    });
    await settle();

    // `class` pass-through lands on the frame root (host layout hook).
    expect(el.querySelector("section.csv.host-overlay")).not.toBeNull();
    expect(el.textContent).toContain("corpus/blue-study.md");
    expect(el.textContent).toContain("Citation 1/2");
    expect(el.textContent).toContain("coronet had vanished");
    const mark = el.querySelector("[data-csv-mark]");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toContain("coronet had vanished from his private safe");
    expect(resolveSource).toHaveBeenCalledTimes(1);
    expect(resolveSource).toHaveBeenCalledWith(REFS[0]);
  });

  it("switches the active ref (next) and re-highlights the new quote", async () => {
    const resolveSource = mdResolver();
    const el = mountViewer({ refs: REFS, resolveSource, activeIndex: 0, title: "t" });
    await settle();

    const next = buttonByLabel(el, "Next citation");
    expect(next).toBeTruthy();
    next!.click();
    flushSync();
    await settle();

    expect(el.textContent).toContain("Citation 2/2");
    const mark = el.querySelector("[data-csv-mark]");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toContain("Holmes examined the ledger");
    expect(resolveSource).toHaveBeenCalledTimes(2);
  });

  it("honors the activeIndex prop for the initially-active citation", async () => {
    const el = mountViewer({ refs: REFS, resolveSource: mdResolver(), activeIndex: 1, title: "t" });
    await settle();
    expect(el.textContent).toContain("Citation 2/2");
    expect(el.querySelector("[data-csv-mark]")?.textContent).toContain("Holmes examined");
  });

  it("shows the graceful not-found note when the quote is not in the source", async () => {
    const el = mountViewer({
      refs: [
        {
          rawRef: "corpus/blue-study.md",
          section: "X",
          excerpt: "a passage that is nowhere in this document",
        },
      ],
      resolveSource: mdResolver(),
      title: "t",
    });
    await settle();
    expect(el.querySelector("[data-csv-mark]")).toBeNull();
    expect(el.textContent).toContain("Quote not located in the source");
    // The document still renders (show anyway).
    expect(el.textContent).toContain("Holmes examined the ledger");
  });

  it("surfaces resolver failures as a clear source-unavailable state", async () => {
    const el = mountViewer({
      refs: REFS,
      resolveSource: vi.fn(async () => {
        throw new Error("404 sources/corpus/blue-study.md");
      }),
      title: "t",
    });
    await settle();
    expect(el.textContent).toContain("Source unavailable");
    expect(el.textContent).toContain("404 sources/corpus/blue-study.md");
  });

  it("surfaces an unknown payload kind as unsupported (body seam boundary)", async () => {
    const el = mountViewer({
      refs: REFS,
      // A custom (v2) kind is typed against the BASE, not the closed v1 union.
      resolveSource: vi.fn(async (): Promise<SourcePayloadBase> => ({ kind: "docx" })),
      title: "t",
    });
    await settle();
    expect(el.textContent).toContain("Source unavailable");
    expect(el.textContent).toContain('unsupported source payload kind "docx"');
  });
});

describe("CitedSourceViewer qualified toolbar (immo parity)", () => {
  // Refs spanning TWO source documents: 2 in blue-study.md + 1 in notes.md.
  const MULTI_DOC_REFS: CitedSourceRef[] = [
    ...REFS,
    { rawRef: "corpus/notes.md", section: "Notes", excerpt: "a passage from the second document" },
  ];

  it("shows the Doc x/y navigator only when refs span multiple documents", async () => {
    const single = mountViewer({ refs: REFS, resolveSource: mdResolver(), title: "t" });
    await settle();
    expect(single.textContent).not.toContain("Doc");
    unmount(instance!);
    instance = null;
    host!.remove();

    const multi = mountViewer({ refs: MULTI_DOC_REFS, resolveSource: mdResolver(), title: "t" });
    await settle();
    expect(multi.textContent).toContain("Doc");
    expect(multi.textContent).toContain("1/2");
    expect(multi.textContent).toContain("Citation 1/3");
  });

  it("Next document jumps to the FIRST ref of the next source file and loads it", async () => {
    const resolveSource = mdResolver();
    const el = mountViewer({
      refs: MULTI_DOC_REFS,
      resolveSource,
      activeIndex: 0,
      title: "t",
    });
    await settle();

    const nextDoc = buttonByLabel(el, "Next document");
    expect(nextDoc).toBeTruthy();
    nextDoc!.click();
    flushSync();
    await settle();

    // Jumped to ref index 2 (first ref of corpus/notes.md) -> Citation 3/3, Doc 2/2.
    expect(el.textContent).toContain("Citation 3/3");
    expect(el.textContent).toContain("Doc 2/2");
    expect(resolveSource).toHaveBeenLastCalledWith(MULTI_DOC_REFS[2]);
    expect(el.querySelector("[data-csv-mark]")?.textContent).toContain(
      "passage from the second document",
    );
  });

  it("renders the Ouvrir raw-source link from the sourceHref callback (DS Link)", async () => {
    const el = mountViewer({
      refs: REFS,
      resolveSource: mdResolver(),
      sourceHref: (r: CitedSourceRef) => `./sources/${r.rawRef}`,
      title: "t",
    });
    await settle();
    const link = el.querySelector("a.csv-tb-open");
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain("Ouvrir");
    expect(link!.getAttribute("href")).toBe("./sources/corpus/blue-study.md");
    expect(link!.getAttribute("target")).toBe("_blank");
    // REAL DS component, not a raw anchor.
    expect(link!.className).toContain("st-link");
  });

  it("hides the Ouvrir link when sourceHref is absent or resolves null", async () => {
    const el = mountViewer({ refs: REFS, resolveSource: mdResolver(), title: "t" });
    await settle();
    expect(el.querySelector("a.csv-tb-open")).toBeNull();
    unmount(instance!);
    instance = null;
    host!.remove();

    const nullHref = mountViewer({
      refs: REFS,
      resolveSource: mdResolver(),
      sourceHref: () => null,
      title: "t",
    });
    await settle();
    expect(nullHref.querySelector("a.csv-tb-open")).toBeNull();
  });

  it("uses REAL design-system controls for the toolbar (principal requirement)", async () => {
    const el = mountViewer({
      refs: MULTI_DOC_REFS,
      resolveSource: mdResolver(),
      onClose: () => {},
      title: "t",
    });
    await settle();
    // IconButton for every ‹/›/✕ control; no bespoke button classes remain.
    const dsIconButtons = el.querySelectorAll("button.st-iconButton");
    expect(dsIconButtons.length).toBeGreaterThanOrEqual(5); // 2 cit + 2 doc + close
    expect(el.querySelector(".csv-tb-btn")).toBeNull();
    expect(el.querySelector(".csv-close")).toBeNull();
  });
});

describe("CitedSourceViewer grouped thread — graphify scope parity (§S.6.1)", () => {
  const GROUP_NOTES_TEXT =
    "# Notes\n\nHere is a passage from the second document indeed.\n\n" +
    "Later, the doctor wrote his notes by the fire.";
  const GROUP_A: CitedSourceGroup = {
    id: "e:holmes",
    label: "Sherlock Holmes",
    refs: [
      {
        rawRef: "corpus/blue-study.md",
        section: "Chapter 1",
        excerpt: "Holmes examined the ledger in silence",
      },
      {
        rawRef: "corpus/notes.md",
        section: "Notes",
        excerpt: "a passage from the second document",
      },
    ],
  };
  const GROUP_B: CitedSourceGroup = {
    id: "e:watson",
    label: "John Watson",
    refs: [
      {
        rawRef: "corpus/blue-study.md",
        section: "Chapter 2",
        excerpt: "the coronet had vanished from his private safe",
      },
      {
        rawRef: "corpus/notes.md",
        section: "Notes",
        excerpt: "the doctor wrote his notes",
      },
    ],
  };
  const GROUPS = [GROUP_A, GROUP_B];
  const groupResolver = () =>
    vi.fn(
      async (r: CitedSourceRef): Promise<SourcePayload> =>
        r.rawRef === "corpus/notes.md"
          ? { kind: "markdown", text: GROUP_NOTES_TEXT }
          : { kind: "markdown", text: SOURCE_TEXT },
    );

  it("defaults to Entité scope: toggle shown, per-entity counter, no entity indicator", async () => {
    const el = mountViewer({ refs: [], groups: GROUPS, resolveSource: groupResolver(), title: "t" });
    await settle();

    expect(scopeButton(el, "Entité")).toBeTruthy();
    expect(scopeButton(el, "Sélection")).toBeTruthy();
    expect(scopeButton(el, "Entité")?.getAttribute("aria-selected")).toBe("true");
    expect(el.textContent).toContain("Citation 1/2");
    expect(el.querySelector('[aria-label="Entity navigator"]')).toBeNull();
    expect(el.textContent).toContain("Sherlock Holmes");
  });

  it("hides the scope toggle when only one group carries citations, including an empty second group", async () => {
    const el = mountViewer({
      refs: [],
      groups: [GROUP_A, { id: "e:empty", label: "Nobody", refs: [] }],
      resolveSource: groupResolver(),
      title: "t",
    });
    await settle();
    expect(el.querySelector(".csv-tb-scope")).toBeNull();
    expect(el.textContent).toContain("Citation 1/2");
    expect(el.querySelector('[aria-label="Entity navigator"]')).toBeNull();
  });

  it("Entité scope stops at the entity boundary and keeps the entity navigator hidden", async () => {
    const el = mountViewer({
      refs: [],
      groups: GROUPS,
      activeGroupIndex: 0,
      activeIndex: 1,
      resolveSource: groupResolver(),
      title: "t",
    });
    await settle();
    expect(el.textContent).toContain("Citation 2/2");
    expect(buttonByLabel(el, "Next citation")!.disabled).toBe(true);
    expect(el.querySelector('[aria-label="Entity navigator"]')).toBeNull();
  });

  it("switching to Sélection calls onScopeChange, makes the counter global and shows the entity indicator", async () => {
    const onScopeChange = vi.fn();
    const el = mountViewer({
      refs: [],
      groups: GROUPS,
      resolveSource: groupResolver(),
      onScopeChange,
      title: "t",
    });
    await settle();

    scopeButton(el, "Sélection")!.click();
    flushSync();
    await settle();

    expect(onScopeChange).toHaveBeenCalledWith("selection");
    expect(el.textContent).toContain("Citation 1/4");
    const indicator = el.querySelector('[aria-label="Entity navigator"]');
    expect(indicator).not.toBeNull();
    expect(indicator!.textContent).toContain("Entité");
    expect(indicator!.textContent).toContain("1/2");
    expect(indicator!.textContent).toContain("Sherlock Holmes");
  });

  it("Sélection scope crosses the entity boundary and fires onFocusChange(groupId, refIndex)", async () => {
    const onFocusChange = vi.fn();
    const onFocusDetail = vi.fn();
    const resolveSource = groupResolver();
    const el = mountViewer({
      refs: [],
      groups: GROUPS,
      activeGroupIndex: 0,
      activeIndex: 1,
      scope: "selection",
      resolveSource,
      onFocusChange,
      onFocusDetail,
      title: "t",
    });
    await settle();
    expect(onFocusChange).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Citation 2/4");

    buttonByLabel(el, "Next citation")!.click();
    flushSync();
    await settle();

    expect(onFocusChange).toHaveBeenCalledWith("e:watson", 0);
    expect(onFocusDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "e:watson",
        groupIndex: 1,
        groupRefIndex: 0,
        index: 2,
        scope: "selection",
      }),
    );
    expect(el.textContent).toContain("Citation 3/4");
    const indicator = el.querySelector('[aria-label="Entity navigator"]');
    expect(indicator!.textContent).toContain("2/2");
    expect(indicator!.textContent).toContain("John Watson");
    expect(resolveSource).toHaveBeenLastCalledWith(GROUP_B.refs[0]);
    expect(el.querySelector("[data-csv-mark]")?.textContent).toContain("coronet had vanished");
  });

  it("keyboard n/N steps the active scope and e/E jumps entities in Sélection scope", async () => {
    const onFocusChange = vi.fn();
    const el = mountViewer({
      refs: [],
      groups: GROUPS,
      scope: "selection",
      resolveSource: groupResolver(),
      onFocusChange,
      title: "t",
    });
    await settle();
    expect(el.textContent).toContain("Citation 1/4");

    await pressKey("n");
    expect(el.textContent).toContain("Citation 2/4");
    expect(onFocusChange).toHaveBeenLastCalledWith("e:holmes", 1);

    await pressKey("N");
    expect(el.textContent).toContain("Citation 1/4");

    await pressKey("e");
    expect(el.textContent).toContain("Citation 3/4");
    expect(onFocusChange).toHaveBeenLastCalledWith("e:watson", 0);

    await pressKey("E");
    expect(el.textContent).toContain("Citation 1/4");
    expect(onFocusChange).toHaveBeenLastCalledWith("e:holmes", 0);
  });

  it("keyboard e/E is inert in Entité scope", async () => {
    const el = mountViewer({ refs: [], groups: GROUPS, resolveSource: groupResolver(), title: "t" });
    await settle();
    expect(el.textContent).toContain("Citation 1/2");

    await pressKey("e");

    expect(el.textContent).toContain("Citation 1/2");
    expect(el.textContent).toContain("Sherlock Holmes");
    expect(el.querySelector('[aria-label="Entity navigator"]')).toBeNull();
  });

  it("flat refs mode supports n/N as citation stepping", async () => {
    const el = mountViewer({ refs: REFS, resolveSource: mdResolver(), title: "t" });
    await settle();
    expect(el.textContent).toContain("Citation 1/2");

    await pressKey("n");
    expect(el.textContent).toContain("Citation 2/2");

    await pressKey("N");
    expect(el.textContent).toContain("Citation 1/2");
  });

  it("honors activeGroupIndex plus group-relative activeIndex", async () => {
    const resolveSource = groupResolver();
    const el = mountViewer({
      refs: [],
      groups: GROUPS,
      activeGroupIndex: 1,
      activeIndex: 1,
      resolveSource,
      title: "t",
    });
    await settle();

    expect(el.textContent).toContain("John Watson");
    expect(el.textContent).toContain("Citation 2/2");
    expect(resolveSource).toHaveBeenLastCalledWith(GROUP_B.refs[1]);
    expect(el.querySelector("[data-csv-mark]")?.textContent).toContain(
      "the doctor wrote his notes",
    );
  });

  it("pins the retarget and callback contract in the package source", () => {
    const source = readFileSync(resolve(process.cwd(), "src/CitedSourceViewer.svelte"), "utf8");
    expect(source).toMatch(/groups !== lastGroupsProp \|\|/);
    expect(source).toMatch(/refs !== lastRefsProp \|\|/);
    expect(source).toMatch(/activeGroupIndex !== lastActiveGroupProp \|\|/);
    expect(source).toMatch(/activeIndex !== lastActiveProp/);
    expect(source).toMatch(/scope !== lastScopeProp/);
    expect(source).toContain('scope = "entity"');
    expect(source).toContain("onScopeChange = null");
    expect(source).toMatch(/onFocusChange\?\.\(normGroups\[gi\]\?\.id \?\? null, ri\)/);
  });
});
