# E2 memory release reservation

- Decision date: 2026-10-27.
- Previous reserved stable release: `@sentropic/cluster-mesh@0.23.0`.
- New reserved stable release: `@sentropic/cluster-mesh@0.24.0`.
- Cause: voice L1c #757 occupied 0.23.0; the owner reports publication from main on 2026-10-27 at 16:33 UTC, source commit `47c61e5d6dcb8b4c228480fd79750efe5f43aed9`.
- Plan authority: `plan.md` lines 95 and 166 allow substitution of the reserved minor when occupied. This record supersedes its original 0.23.0 reservation; historical freeze evidence remains historical.
- Requested pack-only candidate: `0.23.0-dev.14` → `0.24.0-dev.1`; never publish development candidates.
- Registry observation during this continuation: npm latest is already `0.23.1`; fetched origin/main carries manifest `0.23.2`. The new 0.24 minor remains above both.
- Batch #802 is merged into integration at `18ddefad340e6970db4acf239d8b6e129ad08e28`.
- Follow-up branch: `feat/engram-e2-repin-024`, worktree `tmp/worktrees/mem-repin024`, created from that integration head.
- Conductor disposition, 2026-10-27: resolve the three Makefile selectors by union, retain the repin branch plan with an Inherited line, and use 0.24.0-dev.1 consistently above main's 0.23.2.
- Status: authorized conflicts resolved; package, workspace lock, train constant, selected fixtures and both reserved-next gates updated. Dry runs for memory and artifacts environments resolve; Track retains all 370 events from both parents; scope gate passes against the inherited main parent.
- Merge committed: `b3933c86cbdfd2f0fb46172a2b0d685e6e94aa81`, retaining both integration and main parents. Root lock regenerated through make under the shared Docker flock; generated dependencies removed; cleanup completed.
- Follow-up draft PR: #805, https://github.com/rhanka/sentropic/pull/805, pushed head `7a3a93bffdb03e777b402d35604340c5f15dbc20`, base feat/engram-e2-integration. Exact-head pull_request CI run 40601642671 started 2026-10-27 23:22 UTC.
- Local memory: 166 passed, 23 explicitly blocked skips. Full package suite: 1342 passed. Grants: 3 passed; final preparation regression: 15 passed. E10's nested flock was released externally around 23:31 UTC without this integrator touching any foreign process/env; the disposition request is obsolete. PostgreSQL/final cleanup continue normally.
- Local qualification completed: all nine lanes exit=0/cleanup=0; PostgreSQL 144 passed/4 dedicated-campaign skips; final locked make down exit=0. The 23 E9 Stage B cases remain explicitly blocked.
- Pending: exact-head green CI and READY-REPIN marker. Continuation receipt: `.tmp/rv/integrator-memory-repin024.md`.
- Evidence: `.tmp/rv/integrator-memory-repin024-blocked.md`.

- Repin handoff completed at 2026-10-28T00:20:01Z: draft PR #805, head `7a3a93bffdb03e777b402d35604340c5f15dbc20`; pull_request CI 40601642671 completed/success, attempt 1; all local qualification lanes and cleanup pass. READY-REPIN recorded; no merge/publication.
