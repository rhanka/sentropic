# L1c dedicated interactive capacity study refresh

Observed 2026-10-26 UTC. Q4 commissions the study, not capacity acquisition or a
quota exception. The complete [L0 study](../l0/capacity-study.md), including its
entitlement sources, cost sensitivities, CI displacement and dated arithmetic,
is preserved. Its prices are dated 2026-10-25 observations, not refreshed quotes.

No new billing/entitlement, fresh quota, accepted allocator policy or dated
reservation receipt was supplied to L1c. **Effective admitted/reserved campaign
capacity remains zero.** L1c deterministic configuration/projection tests call
no model and consume zero native qualification turns. Paid speech spend: $0.

| Capacity option studied | Feasibility carried forward |
|---|---|
| Existing normal native share | At most 2/day before competing reservations: 1,025 units require at least 513 allocation days; no dedicated supply |
| Existing native-campaign mode | At most 8/day: at least 129 days, displacing up to 774 CI units; serialized with custody campaigns and protected enrollment/maintenance |
| Separately entitled interactive capacity | Needs legitimate independent supply, purpose/billing approval and an explicit allocator policy/share/concurrency receipt; purchase alone proves no allocatable units |

The nominal ten/day cap only gives the spec's unconstrained 103-day lower
bound. No independent interactive bucket or actual daily share is evidenced.
All figures exclude rolling-window waits, ordinary voice, maintenance, retries,
cloud-budget/ledger/native/license/release waits and later campaigns. Everyday
voice requires sustained entitled turn rate and burst headroom; faster STT
cannot eliminate a backend admission wait.

Campaign `live-stt-m1-r3-1025` remains proposed/unreserved: five tuples × 203
counted native units plus 10 adjunct units. The 750 measured interruptions need
separate per-tuple/control-path samples. Failed/restarted turns still count.
The speech-only allowance remains $5/UTC day and $20 aggregate; it cannot pay
for backend agent capacity. No paid probe, seat purchase or model download ran.

Sol and rhanka's allocator/custody/billing lane must return exact policy and
account-family/entitlement refs, fresh provider-window headroom, current-day
spent/reserved counts (including zeros), daily shares/dates/expiry and a bounded
atomic reservation. Name the capacity source, accepted costs/calendar and
serialization boundary. G-QUOTA stays OPEN until that receipt exists; G-CLOUD
and G-LEDGER additionally gate speech dollars. No option is selected here.
