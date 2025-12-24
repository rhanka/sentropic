# Feature: Streaming Markdown Rendering in Chat

## Objective
Implement markdown streaming rendering in the chat component using `svelte-streamdown` library. This will enable proper rendering of markdown content that arrives incrementally during LLM streaming, handling incomplete markdown blocks gracefully.

**Reference**: TODO.md line 47-48, spec/MARKDOWN_STREAMING.md

## Scope
- **Component**: `ui/src/lib/components/StreamMessage.svelte`
- **Library**: `svelte-streamdown` (Svelte port of Streamdown by Vercel)
- **Scope**: Chat variant only (variant="chat")
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
- [ ] Test markdown rendering during active streaming (incremental updates)
- [ ] Test markdown rendering for completed messages (final content)

### Phase 3: Styling & UX
- [ ] Verify markdown rendering matches existing design system
- [ ] Ensure proper text wrapping and break-words behavior
- [ ] Test with various markdown elements (headers, lists, code blocks, links)
- [ ] Verify scroll behavior remains functional with markdown content
- [ ] Check responsive behavior on different screen sizes

### Phase 4: Testing & Validation
- [ ] Run UI unit tests: `make test-ui`
- [ ] Manual testing: verify markdown streaming in chat panel
- [ ] Test edge cases: empty content, very long content, special markdown characters
- [ ] Verify no regression in job variant rendering (should remain text-only)
- [x] Run type checking: `make typecheck-ui` ✅ Passed
- [ ] Run linting: `make lint`

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
- [x] **Commit 1**: Install svelte-streamdown dependency
- [x] **Commit 2**: Integrate Streamdown component in StreamMessage (both paths)
- [ ] **Commit 3**: Styling adjustments and UX verification
- [ ] **Commit 4**: Tests and validation

## Status
- **Progress**: Phase 1 & 2 completed, Phase 4 partially completed (typecheck passed)
- **Current**: Integration complete, ready for styling verification and testing
- **Next**: Run linting, then manual testing and UX verification

## Questions / Considerations
- Should we configure any `svelte-streamdown` options (security, code highlighting, etc.)?
- Do we need to handle any special markdown extensions (mermaid, math) as mentioned in the spec?
- Should we maintain backward compatibility with plain text rendering as fallback?

