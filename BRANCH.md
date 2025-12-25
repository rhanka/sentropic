# Feature: Markdown Streaming (Chat) + Markdown Rendering in Cards

## Objective
Improve chat readability by rendering streamed assistant content (answer + reasoning) as markdown using `svelte-streamdown`, and render basic markdown styling (bold/italic) in list cards for use cases and companies.

**Reference**: TODO.md line 47-48, spec/MARKDOWN_STREAMING.md

## Scope
- **Component**: `ui/src/lib/components/StreamMessage.svelte`
- **Library**: `svelte-streamdown` (Svelte port of Streamdown by Vercel)
- **Chat**: variant="chat" (answer + reasoning)
- **Cards**: `/cas-usage` and `/entreprises` previews (bold/italic)
- **Impact**: UI only, no API changes required

## Plan / Todo

### Phase 1: Setup & Installation
- [x] Install `svelte-streamdown` dependency using `make install-ui NPM_LIB=svelte-streamdown`
- [x] Verify installation in `ui/package.json` and `ui/package-lock.json`
- [x] Check library documentation and API usage

### Phase 2: Integration in StreamMessage Component
- [x] Import `Streamdown` component from `svelte-streamdown` in `StreamMessage.svelte`
- [x] Replace text-only rendering with `Streamdown` component for streaming content (`st.contentText`)
- [x] Replace text-only rendering with `Streamdown` component for final content (`finalContent`)
- [x] Ensure proper styling compatibility (preserve existing Tailwind classes)
- [x] Render `reasoning_delta` as markdown (small/gray styling kept)
- [x] Preserve reasoning section breaks when a delta starts with `**` and previous char is not whitespace
- [x] Reduce chat markdown header sizes to fit chat bubble UI

### Phase 3: Styling & UX
- [ ] Verify markdown rendering matches existing design system
- [ ] Ensure proper text wrapping and break-words behavior
- [ ] Test with various markdown elements (headers, lists, code blocks, links)
- [ ] Verify scroll behavior remains functional with markdown content
- [ ] Check responsive behavior on different screen sizes

### Phase 4: Testing & Validation
- [x] Run UI unit tests: `make test-ui` ✅ Passed (101 tests)
- [ ] Manual testing: verify markdown streaming in chat panel
- [ ] Test edge cases: empty content, very long content, special markdown characters
- [ ] Verify no regression in job variant rendering (should remain text-only)
- [x] Run type checking: `make typecheck-ui` ✅ Passed
- [x] Run linting: `make lint-ui` ✅ Passed

### Phase 5: CI & Final Validation
- [ ] Verify CI passes: check GitHub Actions after push
- [ ] Ensure build succeeds: `make build-ui`
- [ ] Final manual verification in development environment

## Technical Details

### Current Implementation
- `StreamMessage.svelte` currently renders content as plain text using `whitespace-pre-wrap`
- Content arrives via `content_delta` events and is accumulated in `st.contentText`
- For chat variant, there are two rendering paths:
  1. Streaming: `st.contentText` (during active streaming)
  2. Final: `finalContent` (for completed messages)

### Target Implementation
- Replace `<div class="... whitespace-pre-wrap ...">{content}</div>` with `<Streamdown content={content} />`
- Apply to both streaming and final content rendering paths
- Preserve existing CSS classes for container styling
- Ensure `svelte-streamdown` handles incomplete markdown gracefully

### Library Usage (from spec)
```svelte
<script>
  import { Streamdown } from "svelte-streamdown";
  let content = "";
  // à chaque chunk: content += chunk
</script>

<Streamdown {content} />
```

## Commits & Progress
- [x] **Commit 1** (b570823): Install svelte-streamdown dependency + Integrate Streamdown component in StreamMessage (both paths)
- [x] **Commit 2** (238692d): Render markdown in use case & company cards (marked + DOMPurify, including `company.size`)
- [x] **Commit 3** (df5d240): Render reasoning stream as markdown (small/gray styling)
- [x] **Commit 4** (9f59a55): Preserve reasoning section breaks before `**...**` markers (no whitespace before)
- [x] **Commit 5** (f35425d): Tune chat markdown header sizes (h1/h2/h3/h4+ scale)

## Status
- **Progress**: Core implementation complete ✅ (chat answer + reasoning + cards); tests/typecheck/lint ✅
- **Current**: Ready for manual UX verification in the UI
- **Next**: Push branch + create PR + verify CI

## Questions / Considerations
- Should we configure any `svelte-streamdown` options (security, code highlighting, etc.)?
- Do we need to handle any special markdown extensions (mermaid, math) as mentioned in the spec?
- Should we maintain backward compatibility with plain text rendering as fallback?

