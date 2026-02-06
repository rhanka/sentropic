# Analysis report: JSON rendering during streaming

## Context

The goal is to display JSON (tool call arguments and structured responses) in a formatted, readable way **while streaming**, and handle incomplete/invalid JSON that naturally appears during streaming.

## Current state

### Current rendering
- **File**: `ui/src/lib/components/StreamMessage.svelte`
- **Method**: raw text with `whitespace-pre-wrap`
- **Areas**:
  - `st.toolArgsById[toolId]`: JSON arguments for tool calls (streamed via `tool_call_delta`)
  - `st.contentText`: structured responses (potentially JSON)
  - `step.body`: step bodies (may contain JSON)

### Main problem

**Incomplete/invalid JSON during streaming**:
- JSON is built progressively
- Example: `{"useCaseId": "123", "updates": [` → invalid JSON
- `JSON.parse()` fails on incomplete JSON
- Raw display becomes unreadable for complex JSON

**Examples of partial JSON**:
```json
// Step 1: {"useCaseId"
// Step 2: {"useCaseId": "123"
// Step 3: {"useCaseId": "123", "updates": [
// Step 4: {"useCaseId": "123", "updates": [{"path": "description"
// Step 5: {"useCaseId": "123", "updates": [{"path": "description", "value": "..."}]}
```

## Technical analysis

### 1. The incomplete JSON problem

**How `JSON.parse()` works**:
- Parses **valid and complete** JSON only
- Throws `SyntaxError` on incomplete JSON
- Cannot parse progressively

**Impact on streaming**:
- Impossible to use `JSON.parse()` during streaming
- Raw display is unreadable for complex JSON
- A best‑effort parsing strategy is needed

### 2. Update frequency

**Estimates**:
- `tool_call` deltas: ~10–50ms between deltas
- Typical delta size: 1–20 characters
- Typical final tool‑call JSON size: 100–2000 characters
- Number of deltas per full JSON: 10–100

**Impact**:
- **10–100 parsing attempts** for a full JSON
- Each attempt = validation + formatting (if valid)

### 3. JSON types to handle

**1. Tool call arguments** (`tool_call_delta`):
```json
{
  "useCaseId": "abc123",
  "updates": [
    {"path": "description", "value": "New description"},
    {"path": "problem", "value": "New problem"}
  ]
}
```

**2. Structured responses** (`content_delta`):
```json
{
  "status": "completed",
  "results": [
    {"url": "https://...", "content": "..."}
  ]
}
```

**3. JSON errors**:
```json
{
  "status": "error",
  "error": "Use case not found"
}
```

## Proposed options

### Option 1: Simple JSON formatting with try/catch

**Implementation**:
```svelte
function formatJsonSafely(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // Incomplete JSON: return as‑is or with a hint
    return text + ' ⏳';
  }
}

$: formattedToolArgs = Object.entries(st.toolArgsById).map(([id, args]) => ({
  id,
  formatted: formatJsonSafely(args)
}));
```

**Pros**:
- ✅ Simple to implement (5–10 lines)
- ✅ Auto‑format when JSON is valid
- ✅ No crash on incomplete JSON

**Cons**:
- ❌ No formatting while streaming (invalid JSON)
- ❌ Raw display until JSON is complete

### Option 2: Partial parsing / incremental formatting

**Approach**:
- Attempt to parse a **partial JSON** by trimming trailing invalid tokens
- Example:
  - Input: `{"useCaseId": "123", "updates": [{"path": "desc"`  
  - Try to close braces: `{"useCaseId": "123", "updates": [{"path": "desc"}]}`
- Heuristic: add missing quotes/brackets/braces

**Pros**:
- ✅ Can display partially formatted JSON while streaming
- ✅ Better readability during stream

**Cons**:
- ❌ Complex and error‑prone
- ❌ Might show incorrect structure
- ❌ Needs careful performance and edge‑case handling

### Option 3: Streaming JSON renderer (token‑based)

**Approach**:
- Parse the JSON stream as **tokens** (braces, strings, numbers, etc.)
- Render tokens with indentation based on bracket stack
- Does not require valid JSON to start formatting

**Pros**:
- ✅ Good real‑time formatting
- ✅ Can handle invalid JSON
- ✅ Best readability during streaming

**Cons**:
- ❌ More complex to implement (custom parser)
- ❌ Needs maintenance and tests

### Option 4: Use a tolerant JSON parser

**Approach**:
- Use a parser library that supports **partial/incomplete** JSON
- Example: `jsonc-parser` (VSCode) can parse incomplete JSON and return AST + errors
- Then pretty‑print from AST

**Pros**:
- ✅ Robust handling of invalid JSON
- ✅ No need to reinvent parser

**Cons**:
- ❌ Adds dependency
- ❌ Might be heavy for UI runtime

## Recommendation (short‑term)

Implement **Option 1** immediately:
- Simple, stable
- No risk
- Improves readability once JSON is complete

Add a small UI hint to show “streaming / incomplete” (e.g., `⏳`) to set expectations.

## Recommendation (mid‑term)

If the UX impact of raw JSON is too painful during streaming:
- Evaluate **Option 4** (`jsonc-parser`) to provide tolerant parsing
- Or implement **Option 3** if we want full control

## Implementation notes

### Suggested helpers

```ts
export function formatJsonSafely(text: string): { formatted: string; isValid: boolean } {
  try {
    const parsed = JSON.parse(text);
    return { formatted: JSON.stringify(parsed, null, 2), isValid: true };
  } catch {
    return { formatted: text, isValid: false };
  }
}
```

### UI rendering (example)

```svelte
{#each formattedToolArgs as { id, formatted, isValid }}
  <pre class="json-block {isValid ? 'json-valid' : 'json-pending'}">
    {formatted}{isValid ? '' : ' ⏳'}
  </pre>
{/each}
```

## Edge cases

- **Large JSONs**: use `max-height` + scroll for readability
- **Mixed content**: if `st.contentText` includes non‑JSON text, only format when full JSON is detected
- **Double formatting**: ensure we do not re‑stringify already‑formatted JSON (detect leading `{`/`[` + trim)
- **Performance**: throttle formatting to avoid heavy parsing on every 10ms delta (e.g., debounce at 50–100ms)

## Decision log

- JSON streaming in Svelte UI is currently raw.
- There is a clear UX win to show JSON prettified once complete.
- A tolerant JSON parser could further improve streaming display, but is not required for a first improvement.
