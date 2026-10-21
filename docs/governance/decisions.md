# Owner decisions — 2026-10-19

The contract records these decisions from [the owner’s words](OWNER-DECISIONS-2026-10-19.md) and the [DS anchor boundary](DS-POSITION-G3-2026-10-19.md). The r11 presentation preserves them.
G3 “a” refers to the spec-review v4 choice, not the superseded governance r9 option A.

| Decision | Date | Verbatim quote | Consequence |
| --- | --- | --- | --- |
| G1 | 2026-10-19 | « G1 = option 1 » | Each act has one accountable owner under an explicit mandate. Each repository retains its code, release and data authorities; shared boundaries are jointly frozen. Only unresolved material conflicts escalate to the owner. |
| G2 | 2026-10-19 | « G2 = option 1 » | Engram governs profiles, schemas, fixtures and migrations. The Design System retains and publishes the generic @sentropic/diagram-core executor, layout and rendering. Consumers pin profiles; no second diagram metamodel. |
| G3 | 2026-10-19 | « g3 = a ok » | The Design System owns annotate presentation only: selection, markers and thread display. It receives an opaque anchor and emits proposals; it neither resolves nor persists anchors. Sentropic owns the single model: anchors, threads, resolution and persistence. Diagram anchors reference Engram profiles without copying them. |
| H1 | 2026-10-19 | « il faut prevoir les 2 » | Every Sentropic app supports artifact hosting on a subdomain and on a separate domain. |

| Decision | Updated surfaces |
| --- | --- |
| G1 | Study §2/§6–9; C-01; organization route; decision card; M2; repository README sections. |
| G2 | Study §5–9; C-01/C-16; ontology route; capability C07; decision card; M2/M4; README sections. |
| G3 | Study annotation distinction and row 4, N19, §5–9; C-01/C-04/C-15; annotate route and DS card; capability C11; decision card; M2/M3; README sections. |
| H1 | Study §7/§9; artifact/storage clause; M2; README sections. |

The owner’s capability map is still pending. Implementation, publication, installation and runtime qualification remain separate evidence states; explicit grants still apply to each consequential act.
