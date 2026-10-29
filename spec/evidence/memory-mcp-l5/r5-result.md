# L5 qualification result after host recovery

**NOT QUALIFIED.** The strict checkpoint is a rejected proposal: `accepted=false`, with 1417 validation failures. This is not an accepted L5 checkpoint or permission to activate agent memory. Repeated missing closure files account for many failures; the count is not 1417 independent defects.

| Binding | Value |
| --- | --- |
| Tested source | `99f95df1389db5da711fd08ad1791972055aef93` |
| Engram 0.22.0 candidate SHA-256 | `965c93e326df9866584261061f4e49571cfd74dfe1dc258c0c6894eea121a4e9` |
| Candidate manifest SHA-256 | `576fdf7fe11e4c41813f2ff4207bb4a34cd92e2e475d3edb0777dc030091ecba` |
| Checkpoint SHA-256 | `f4eaebdc02f75db1c845ee1eecc73f429c00372127837298156a3f49cbe17cdf` |
| Tuple SHA-256 | `e1e85810571c87371ca08404e04a9f2b5a4fdf158eda575241ecf45bda414072` |
| Final raw archive SHA-256 | `64c24aabd8edc7c115b4b34d20624594d8c3e875e08761c0cec9cfcd4d0946af` |

## Retained execution

The full `memory-l5-qualify` attempt ran under the shared Docker flock with `ENV=test-memory-l5` last. Its cleanup trap ran `make down`. The final archive `r5-final-run.tgz` retains the manifest, checkpoint and validation, command exits, execution contexts, raw Vitest JSON, compact reports, P01–P10 bundles and intermediate failure observations at their original relative paths. Extract it at a clean checkout of the tested source to inspect those paths. Sidecars bind the committed compact artifacts. Evidence-only commits after the tested source do not represent another source execution.

| Observation | Result |
| --- | --- |
| Tooling | 146 passed, no failed/skipped/todo assertions |
| P09 source regressions | 18 files, 90 passed; complete execution-bound bundle |
| P10 source regressions | 24 passed; complete execution-bound bundle |
| Native positive controls | 2 passed; actual sync/async GCC compilation creates ELF objects under candidate addon paths and is detected |
| Ordinary disabled installation | Passed with scripts and optional dependencies enabled; zero candidate native compiles and zero forbidden runtime counters |
| Packed disabled installation | Passed |
| LOT=2 / LOT=3 acceptance | Refused: canonical `tools/memory-mcp-l5/artifacts/lot2-manifest.json` absent; Lot 3 source regressions execute before refusal |
| Packed exports | Failed: frozen broker 0.1.0 does not export `./memory-reference` |
| Four required packed E4 suites | Missing; their command failures are retained |

The native predicate attributes successful compiler launches and source-build `.o`/`.obj` outputs inside candidate addons. Unrelated tree-sitter objects, prebuilt `.node` files, node-gyp orchestration and failed compiler spawn attempts do not count as compilation. Real compiler failures after launch still count. No check was removed and no timeout or assertion was waived. The actual compiler controls use a separate disposable compiler-equipped container; ordinary installation uses the unchanged pinned Node image.

P01–P08 bundles now retain the available observations and explicit missing/failed cases. Source-only observations do not satisfy installed E4 acceptance. P09 family mappings require nonempty all-passed suites and actual source-byte bindings; they do not substitute for canonical E4 cases. Predecessor mapping resolution does not claim execution of the four later remote R2/R7a acceptance suites.

## Remaining technical gates

- `gr-conductor` must supply the actual L5/P3-bound E2 envelope, backend/configuration/neutral/profile/driver/lock closure and crash/replay evidence. The stable-successor C9 receiving ACK covers Engram 0.21.3 / mesh 0.24.0 and explicitly excludes this L4 candidate and frozen L5; it cannot be transplanted.
- Resolve frozen composition through its authorized adoption process: #771's reference implementation is broker 0.2.0, whereas frozen P3 contains broker 0.1.0. #777 withdrew platform edits; #783 remains a separate adoption/successor-freeze proposal. No archive was silently replaced.
- Implement and execute the missing packed identity-source refusal, SDK discovery/call, restart/lost-response and confirmation/step-up suites, platform schema/wire profiles and mesh context suite against that installed E4 tuple. Retain runtime, import graph, installed lock and complete closure evidence.
- Complete authenticated provenance verification against accepted trust roots. The strict verifier still explicitly blocks unestablished CI, owner and role provenance; actor strings or unsigned local JSON cannot close these gates.
- Obtain successful final-head CI and two independent eligible complementary reviews. [Review selection](r5-review-selection.md) records the unavailable exact reviewer identities and historical #777 reconciliation; no current consensus or reviewed-ready status is claimed.

These are harness/integration gaps. The run does not establish a defect in the unchanged producer candidate bytes.

## Minimal genuine owner actions

1. Supply detached authorization for amended L0 freeze SHA-256 `0541b15ba4d5e49ba3b30d92da1c5e3c2fd668e40937e4f942103a678e849bfb` and P3 SHA-256 `1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730`. Existing text authorization is not a detached signature.
2. After the technical tuple passes and successful CI exists, record one authenticated decision through the enrolled sent-tech.ca OIDC + 2FA provenance channel, bound to `tupleSha256`, `authoritySourceSha256`, `ciRunId`, `actorRef=owner:antoinefa` and `recordedAt`: either actual UAT `passed` with `policySha256`, or explicit `owner-deferred` to `owningLot=L6` or `L8` with a reason. Do not approve this failed tuple.
3. Supply authenticated acceptance for each explicit role `l4`, `platform`, `broker`, `transport`, bound to that same tuple, L0 authority digest and CI run. One authorized owner may cover multiple roles; each disposition must be explicit.

The verifier must be able to authenticate the channel and accepted roots first. These owner actions do not replace the remaining technical work; no agent signature is represented as owner provenance.
