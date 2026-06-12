# docs-template scaffold (illustration for SPEC_EVOL_DOCS_TEMPLATE.md)

Illustration only. Lives under `spec/` ON PURPOSE: no CI path-filter matches it,
nothing here joins any build. The compilable reference implementation is
`sent-tech-design-system/apps/docs` (every path below is relative to that repo).

## Target package layout -> reference implementation mapping

```
@sentropic/docs-template
├── engine/                      # tri-framework declarative rendering
│   ├── node-spec.ts             # <- apps/docs/src/lib/framework/examples.ts (types only:
│   │                            #    NodeSpec/ComponentNodeSpec/ElementNodeSpec/FrameworkId;
│   │                            #    the EXAMPLES registry + ComponentName union stay client-side)
│   ├── node-to-code.ts          # <- apps/docs/src/lib/framework/nodeToCode.ts (pure, as is)
│   ├── SvelteNode.svelte        # <- apps/docs/src/lib/framework/SvelteNode.svelte
│   │                            #    (mechanism as is; the component table becomes an
│   │                            #     injected ComponentRegistry — the ONE real refactor)
│   ├── react-island.ts          # <- apps/docs/src/lib/framework/react-island.ts (same injection)
│   ├── vue-island.ts            # <- apps/docs/src/lib/framework/vue-island.ts  (same injection)
│   ├── TabbedExample.svelte     # <- apps/docs/src/lib/framework/TabbedExample.svelte
│   └── FrameworkPreview.svelte  # <- apps/docs/src/lib/framework/FrameworkPreview.svelte
├── content/
│   ├── catalog.ts               # <- apps/docs/src/lib/components-catalog.ts (schema +
│   │                            #    groupByCategory/componentHref; COMPONENTS data stays client)
│   └── navigation.ts            # <- apps/docs/src/lib/docs-navigation.ts (schema + builders;
│                                #    DOCS_TOP_NAV etc. data stays client)
├── state/
│   ├── url-state.ts             # <- apps/docs/src/lib/url-state.ts (valid theme/framework
│   │                            #    lists become client config)
│   ├── locale.svelte.ts         # <- apps/docs/src/lib/locale.svelte.ts (as is)
│   ├── framework.svelte.ts      # <- apps/docs/src/lib/framework.svelte.ts (as is)
│   └── color-mode.svelte.ts     # <- apps/docs/src/lib/color-mode.svelte.ts (as is)
├── chrome/
│   ├── contract.ts              # <- props type extracted from apps/docs/src/lib/chrome/ChromeCarbon.svelte
│   │                            #    (all 5 tenant chromes already implement it de facto)
│   └── DefaultChrome.svelte     # <- the default layout chrome in apps/docs/src/routes/+layout.svelte,
│                                #    built on AppChrome/AppHeader (published DS components)
├── chat/
│   ├── ChatWidget.svelte        # <- apps/docs/src/lib/chat/ChatWidget.svelte (as is)
│   ├── chat-config.ts           # <- apps/docs/src/lib/chat/chat-config.ts (wire contract, as is)
│   └── anon-counter.svelte.ts   # <- apps/docs/src/lib/chat/anon-counter.svelte.ts (as is)
└── search/                      # NEW — scaffolded in sent-tech-design-system PR #24
    ├── search-index.ts          # <- apps/docs/src/lib/chat/docs-search-index.ts
    │                            #    (DocsSearchDocument contract + pure lexical engine +
    │                            #     buildAssistantPrompt; the buildDocsSearchIndex()
    │                            #     derivation stays client-side)
    └── DocsSearch.svelte        # <- apps/docs/src/lib/chat/DocsSearch.svelte
                                 #    (DS Search field + conversational escalation through
                                 #     the chat wire contract)
```

## What a client ships (and nothing else)

1. content data: `ComponentEntry[]` (or registry-derived), nav arrays, i18n copy;
2. a per-framework `ComponentRegistry` (name -> implementation) for the engine;
3. optional tenant chromes implementing `chrome/contract.ts`;
4. config: valid themes, valid frameworks, locales, `PUBLIC_CHAT_ENDPOINT` (optional);
5. optional rich pages (Svelte routes) for documented entries.

Worked example, dataviz (`dataviz/apps/site`): its `DemoEntry` registry maps to
content data; its 4 tenants map to URL state config; its missing search/i18n/
React-Vue live demos come from the template for free.

See `contracts.ts` next to this file for the standalone-compilable contracts.
