import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import CitedSourceViewer from "../src/CitedSourceViewer.svelte";
import type {
  CitedSourceFocus,
  CitedSourceGroup,
  CitedSourceRef,
  SourcePayload,
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

describe("CitedSourceViewer (markdown body path)", () => {
  it("renders refs, resolves the source and highlights the active quote", async () => {
    const resolveSource = mdResolver();
    const el = mountViewer({
      refs: REFS,
      resolveSource,
      activeIndex: 0,
      title: "corpus/blue-study.md",
    });
    await settle();

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
      resolveSource: vi.fn(async (): Promise<SourcePayload> => ({ kind: "docx" })),
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

  it("hides the Ouvrir link when sourceHref is absent", async () => {
    const el = mountViewer({ refs: REFS, resolveSource: mdResolver(), title: "t" });
    await settle();
    expect(el.querySelector("a.csv-tb-open")).toBeNull();
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

describe("CitedSourceViewer grouped thread + scope (S.6 extended API)", () => {
  const GROUPS: CitedSourceGroup[] = [
    { id: "ent-holmes", label: "Sherlock Holmes", refs: [REFS[0]!, REFS[1]!] },
    {
      id: "ent-notes",
      label: "Case notes",
      refs: [
        {
          rawRef: "corpus/notes.md",
          section: "Notes",
          excerpt: "a passage from the second document",
        },
      ],
    },
  ];

  it("shows the scope toggle + Entité x/y only when 2+ groups exist", async () => {
    const flat = mountViewer({ refs: REFS, resolveSource: mdResolver(), title: "t" });
    await settle();
    expect(flat.querySelector(".st-contentSwitcher")).toBeNull();
    expect(flat.textContent).not.toContain("Entité");
    unmount(instance!);
    instance = null;
    host!.remove();

    const grouped = mountViewer({ groups: GROUPS, resolveSource: mdResolver(), title: "t" });
    await settle();
    // ContentSwitcher (DS) with the two qualified scope options.
    const switcher = grouped.querySelector(".st-contentSwitcher");
    expect(switcher).not.toBeNull();
    expect(switcher!.textContent).toContain("Entité");
    expect(switcher!.textContent).toContain("Sélection");
    expect(grouped.textContent).toContain("Entité 1/2");
  });

  it("selection scope (default): the citation thread runs across all groups", async () => {
    const el = mountViewer({ groups: GROUPS, resolveSource: mdResolver(), title: "t" });
    await settle();
    expect(el.textContent).toContain("Citation 1/3");
    // Walk to the last ref across the group boundary.
    buttonByLabel(el, "Next citation")!.click();
    flushSync();
    await settle();
    buttonByLabel(el, "Next citation")!.click();
    flushSync();
    await settle();
    expect(el.textContent).toContain("Citation 3/3");
    expect(el.textContent).toContain("Entité 2/2");
  });

  it("entity scope: the citation thread is clamped to the active group", async () => {
    const el = mountViewer({
      groups: GROUPS,
      scope: "entity",
      resolveSource: mdResolver(),
      title: "t",
    });
    await settle();
    expect(el.textContent).toContain("Citation 1/2"); // group 1 has 2 refs
    const next = buttonByLabel(el, "Next citation")!;
    next.click();
    flushSync();
    await settle();
    expect(el.textContent).toContain("Citation 2/2");
    // Clamped: next is disabled at the group boundary (does not spill to group 2).
    expect(buttonByLabel(el, "Next citation")!.disabled).toBe(true);
    expect(el.textContent).toContain("Entité 1/2");
  });

  it("Entité ‹/› jumps to the FIRST ref of the neighbour group", async () => {
    const resolveSource = mdResolver();
    const el = mountViewer({ groups: GROUPS, resolveSource, title: "t" });
    await settle();
    buttonByLabel(el, "Next entity")!.click();
    flushSync();
    await settle();
    expect(el.textContent).toContain("Entité 2/2");
    expect(resolveSource).toHaveBeenLastCalledWith(GROUPS[1]!.refs[0]);
    expect(el.querySelector("[data-csv-mark]")?.textContent).toContain(
      "passage from the second document",
    );
  });

  it("emits onFocusChange with group/doc coordinates on mount and on nav", async () => {
    const focuses: CitedSourceFocus[] = [];
    const el = mountViewer({
      groups: GROUPS,
      resolveSource: mdResolver(),
      onFocusChange: (f: CitedSourceFocus) => focuses.push(f),
      title: "t",
    });
    await settle();
    expect(focuses.length).toBe(1);
    expect(focuses[0]).toMatchObject({
      index: 0,
      scope: "selection",
      groupId: "ent-holmes",
      groupIndex: 0,
      groupRefIndex: 0,
      docLocator: "corpus/blue-study.md",
    });

    buttonByLabel(el, "Next entity")!.click();
    flushSync();
    await settle();
    expect(focuses.length).toBe(2);
    expect(focuses[1]).toMatchObject({
      index: 2,
      groupId: "ent-notes",
      groupIndex: 1,
      groupRefIndex: 0,
      docLocator: "corpus/notes.md",
    });
  });

  it("toggling the scope switch re-scopes the citation counter", async () => {
    const el = mountViewer({ groups: GROUPS, resolveSource: mdResolver(), title: "t" });
    await settle();
    expect(el.textContent).toContain("Citation 1/3"); // selection scope
    const entityTab = [...el.querySelectorAll(".st-contentSwitcher [role='tab']")].find(
      (b) => b.textContent?.trim() === "Entité",
    ) as HTMLButtonElement;
    expect(entityTab).toBeTruthy();
    entityTab.click();
    flushSync();
    await settle();
    expect(el.textContent).toContain("Citation 1/2"); // entity scope, group 1
  });
});
