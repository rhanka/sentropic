// docs-template — typed contracts (illustration for SPEC_EVOL_DOCS_TEMPLATE.md §4).
//
// Standalone-compilable, ZERO imports, deliberately outside packages/ (no CI
// path-filter matches spec/**). Shapes are drafted from real call-sites in
// sent-tech-design-system/apps/docs; the search contracts are already
// implemented + tested there (PR #24, docs-search-index.ts, 9 vitest tests).

// ── locale ───────────────────────────────────────────────────────────────────
// v1 keeps the DS docs locale set; making the set client-configurable is a
// ratification point (the mechanism — copy objects + a reactive store — is
// locale-agnostic already).
export type Locale = "fr" | "en";
export type LocalizedText = Record<Locale, string>;

// ── engine: declarative tri-framework example tree ──────────────────────────
export type FrameworkId = "svelte" | "react" | "vue";

export interface ComponentNodeSpec {
  comp: string;
  props?: Record<string, unknown>;
  children?: NodeSpec[];
}

export interface ElementNodeSpec {
  el: string;
  props?: Record<string, unknown>;
  children?: NodeSpec[];
}

export type NodeSpec = string | ComponentNodeSpec | ElementNodeSpec;

/**
 * THE dependency inversion that frees the engine from hard
 * `@sentropic/design-system-*` imports: each client provides one registry per
 * framework (Svelte components for inline rendering, React/Vue components for
 * the islands). The engine must render with a FAKE registry containing zero
 * design-system imports (boundary test, SPEC §3).
 */
export interface ComponentRegistry<TComponent> {
  resolve(name: string): TComponent | undefined;
}

/** Returned by the React/Vue island mounters (mount is framework-specific). */
export interface IslandHandle {
  unmount(): void;
}

// ── content: one catalog drives nav, breadcrumb, prerender and search ───────
export type ComponentStatus = "documented" | "stub";

export interface ComponentEntry {
  /** Display name, matches the exported component identifier. */
  name: string;
  /** URL slug under `/components/<slug>/`. */
  slug: string;
  status: ComponentStatus;
  /** Functional grouping for the index/sidebar (client-defined vocabulary). */
  category: string;
  /** Optional landing page slug when several entries share one page. */
  groupSlug?: string;
  description: LocalizedText;
}

export interface DocsNavItem {
  label: string;
  href: string;
  external?: boolean;
}

// ── chrome: the contract every tenant chrome implements ─────────────────────
// `Snippet` is Svelte 5's slot-content type; aliased here to keep this file
// dependency-free. The five DS tenant chromes already implement this shape.
type Snippet = unknown;

export interface DocsChromeProps {
  children: Snippet;
  activeThemeId: string;
  isThemeOpen: boolean;
  onThemeToggle: () => void;
  themeSwitcher: Snippet;
  frameworkSwitcher: Snippet;
  localeSwitcher: Snippet;
  compareButton: Snippet;
  mobileMenuOpen: boolean;
  onMobileMenuToggle: () => void;
}

// ── chat wire: shared by the assistant widget AND the search escalation ─────
export type ChatWireRole = "user" | "assistant" | "system";

export interface ChatWireMessage {
  role: ChatWireRole;
  content: string;
}

/** POST body sent to the configurable external endpoint (PUBLIC_CHAT_ENDPOINT). */
export interface ChatRequestBody {
  messages: ChatWireMessage[];
  locale: string;
}

/** `reply` (fallbacks `message`/`content`) is read as the assistant text. */
export interface ChatResponseBody {
  reply?: string;
  message?: string;
  content?: string;
}

// ── search: the indexable unit + result shape ────────────────────────────────
export type DocsSearchKind = "component" | "guide" | "view";

/**
 * INDEXING CONTRACT: one document = one navigable docs target. The template
 * owns the pure lexical engine (accent-insensitive, AND semantics, scored
 * title > keywords > excerpt) and the grounded-prompt builder for the
 * conversational escalation; each client derives its documents from its own
 * declarative source (DS: components-catalog; dataviz: demo registry).
 */
export interface DocsSearchDocument {
  id: string;
  url: string;
  kind: DocsSearchKind;
  title: LocalizedText;
  excerpt: LocalizedText;
  keywords: string[];
}

export interface DocsSearchResult {
  doc: DocsSearchDocument;
  score: number;
}
