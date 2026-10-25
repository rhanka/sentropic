# L0 configuration and placement freeze

Authority: approved r3 §§3.1/6.1/10 and Q1/Q2/Q6. Every row is a planned configuration, currently unavailable for live-speech qualification. All selectors belong to one cluster-mesh speechProfile schema/projection (L1c), with independent STT/TTS/duplex bindings, exact artifact/model identity, pipeline, placement, policy/account references and mic mode. No client, controller or adapter supplies a hidden fixed engine. Fallback lists start empty; profile edits require a new session or explicit quiescent rebind and renewed egress consent.

## Required placement matrix

| Placement | Media path and selectable stages | Required lots/gates and exit evidence |
|---|---|---|
| Local h2a-style CLI/desktop (`endpoint-native`) | Endpoint mic/VAD/STT/TTS; existing selected Codex controller owns work. Cloud STT/TTS can be explicitly selected instead. | L1c/L2/L3/L3b/L4/L5/L6/L8/L9/L13/Lp0/Lp1/L7; G-CODEX/NATIVE/LICENSE/QUOTA/LEDGER/CLOUD/PUBLISH. Linux headset first, both modes, no same-turn engine switch. |
| Online web + cloud (`cloud-relay`) | Browser capture → authenticated same-origin L16 relay → selected cloud stages; server holds credentials/accounting. | L16/L17; G-APP-HOST/APP/CLOUD/LEDGER. Bound Origin/grant/lease, worker cancellation ACK, accessible Stop and explicit region/retention disclosure. |
| Browser-local (`browser-wasm`) | Pinned local STT/TTS in workers; verified model download before mic activation; only committed text/control/usage reaches host. | L17; G-NATIVE/LICENSE/APP. $0 speech API fees, no audio upload, FR/EN/device/memory evidence. Browser-native voices cannot silently replace missing local TTS. |
| Web + local h2a-style companion (`local-companion`) | Browser control pairs with endpoint bridge and native stage registry, including explicitly admitted cloud stages. | L17b; G-APP/NATIVE. Origin-bound pairing/expiry/revocation, consent, hostile-origin refusal and disconnect fence; never arbitrary localhost access. |
| Web + cluster-hosted local engines (`cluster-hosted`) | Audio goes to declared host; qualified native STT/TTS workers use existing resource admission/leases. | L17c; G-HOSTED/NATIVE/APP/LEDGER. Tenant isolation, bounded CPU/RAM/slots, cancellation and accounting; no speech-specific scheduler. Compute costs remain even at $0 speech API fees. |
| Remote h2a/cowork target | Endpoint/browser/companion media placement binds to a remote structured session, independent of engine location. | L20/L21a/b/L19; G-REMOTE/WINDOWS/APP. M3/M4 source/controller/effect receipts and native OS/device tuple; no remote microphone activation. |

All rows require both key mode and open mic, visible consent/target/provider/model/placement, mic initially off, one committed utterance, immediate local playback clear, the same authoritative dispatch fence and unresolved-effect barrier. Unknown combinations stay visible with a gate reason. Native permissions remain explicit source-bound controls. A failed headset open-mic profile blocks its acceptance instead of shrinking scope to key mode.

## Primary M1 candidate tuples

These names freeze campaign identities; exact media/model/voice digests and cloud API IDs remain entry evidence. A missing artifact/schema is an unavailable tuple, not permission to invent an ID or use `latest`.

| Tuple | STT / placement | TTS / placement | Qualification reservation |
|---|---|---|---|
| A | faster-whisper-ts, tiny, endpoint worker; candidate source and tiny revision in dependencies | eSpeak NG, endpoint executable; exact voice/artifact gated | 203 native units; local speech API $0 |
| B | faster-whisper-ts, base, endpoint worker; model revision/digest gated | Same selectable eSpeak NG binding | 203 native units; local speech API $0 |
| C | OpenAI `gpt-live-transcribe`, selected cloud route; exact schema/entitlement gated | Local eSpeak NG binding | 203 native units; at most $4 speech envelope |
| D | OpenAI `gpt-realtime-whisper`, selected cloud route; exact schema/entitlement gated | Local eSpeak NG binding | 203 native units; at most $4 speech envelope |
| E | Mistral Voxtral Realtime 3, exact API model ID/delay gated (r3 candidate delay 160 ms) | Mistral Voxtral Mini TTS 3, exact API model/voice gated | 203 native units; at most $4 speech envelope |
| Functional adjunct | whisper.cpp second implementation and non-primary local/cloud stage combinations | Independently selectable compatible stage | 10 shared native units, no extra p95 claim |

Each primary tuple: 50 attempts × open-mic/key/Stop = 150 measured interruptions; three chains of one seed plus 50 successor turns = 153 units, plus 50 reserve = 203. Across five: 750 measured interruptions and 1,015 units; with adjunct, 1,025. FR/EN functional checks remain mandatory; pooled language results cannot claim language-specific p95. Each new model/placement/control/agent version requires a new receipt.

M1's known local TTS diversity gap (Opus P3-14): eSpeak NG is the single planned local synthesis engine. Its registry is extensible; Muse must qualify a second local ONNX/sherpa voice and estimate a conditional lot before claiming multi-engine local TTS. This does not silently add work to L6a or remove any required M1 tuple.

## Tracked unadmitted configurations

| Configuration | Owner / blocking evidence | Planned treatment |
|---|---|---|
| OpenAI Realtime standard/mini; GPT-Live | Muse L10/L11 + provider/gateway lane: exact schemas/models, cancellation/history, entitlement, price/retention and remaining campaign envelope | Later selectable native-duplex profiles; backend remains the existing agent |
| Gemini Live stable/extended thinking | Sol L12 + provider lane: exact current schema/model, async cancellation/history/usage, entitlement/terms | Later native-duplex profiles; no late FunctionResponse resurrection |
| Deepgram Flux | Provider lane accountable rhanka; Sol handoff: pinned multilingual ID, endpoint/resume semantics, JS transport, terms/price and usage | Outside present estimates; separate adapter/campaign reservation |
| ElevenLabs Scribe/TTS/realtime | Provider lane accountable rhanka; Muse handoff: exact stage IDs, JS transport, voice rights/retention, cancellation and price units | Outside present estimates; separate adapter/campaign reservation |
| sherpa-onnx STT/TTS | Muse + engine/security lane: pinned FR/EN acoustic and voice model licenses/digests, native/WASM receipts and quality | Separate conditional estimate, including second local TTS candidate |
| Browser-native SpeechRecognition/speechSynthesis | Muse + privacy/license lane: explicit opt-in label **network-backed, uncontrolled retention** until an exact local implementation/voice proves otherwise; browser/OS/vendor behavior not controlled uniformly | Visible unadmitted opt-in entry, never default or substitute for browser-local $0/no-egress |
| Nova Sonic | Provider lane accountable rhanka; G-AWS: exact model/region rates, entitlement and bidirectional JS/native path | Optional outside totals; no borrowed pricing estimate |
| Voxtral 2602 or v3 self-host | Muse + engine/security lane; G-VOXTRAL-SELFHOST: distinct weights/license/version and interpreter-free serving; do not transfer 2602 Apache terms to v3 | Optional outside totals; hosted placement first consumes already qualified engines |

No row above is dropped because its provider/model is not yet admitted. The catalogue can express every evidenced combination; that is not a claim that arbitrary codecs, voices, regions or engines already work.
