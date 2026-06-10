---
name: debug
description: Use on any bug, test failure, or unexpected behaviour BEFORE proposing a fix — runs the generic evidence-first root-cause loop.
---

# harness/debug

Native sentropic debugging. Open it with `harness debug "<symptom>"` (records a WorkEvent), then run the
loop. No fix is proposed before the root cause is proven by evidence.

## The loop

1. **Reproduce** — a deterministic, minimal repro. If you can't reproduce it, you can't fix it.
2. **Evidence** — gather facts with the tools, never assume: `make logs-<service>`, `make db-query
   QUERY="…"`, container state (`make ps`), `grep`/`diff`. Read the actual error, the actual state.
3. **One hypothesis** — the single most-likely cause that the evidence supports. Write it down.
4. **One fix** — the smallest change that addresses THAT cause. No shotgun edits, no "while I'm here".
5. **Re-observe** — rerun the repro. Confirm the symptom is gone AND the evidence changed as predicted.
6. **Regression test** — promote the repro into a test (`harness/test`) so it can't silently return.

## Rules

- No "probably" / "maybe" / "should be" — verify with a tool before asserting. A claim without evidence
  is a guess.
- Change ONE thing at a time; if the symptom persists, revert it before trying the next.
- A failing assertion is data, not noise — read the diff, don't loosen the assertion.
- Live surfaces (UI/stream/API/extension) have a dev-lane bootstrap (Playwright/probe targets); use it to
  observe the real behaviour rather than reasoning in the abstract.

## Done

Root cause named + evidenced, minimal fix in place, repro green as a regression test, no collateral
change. Hand verification to `harness verify`.
