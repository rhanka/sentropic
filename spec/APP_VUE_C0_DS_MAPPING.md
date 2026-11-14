# C0: design-system usage and Vue workload recalibration

Inputs and citation keys are defined in [the audit](APP_VUE_C0_AUDIT.md). This is an audit mapping for the already-approved lots; it neither expands their allowed paths nor approves a new exception. **DS session review: pending.** The Svelte primitive contracts at the DS pin establish available concepts and props, not the availability or parity of the future Vue Vapor output. No DS package was installed.

## Reproducible source census

For each `.svelte` blob under `packages/chat-ui/src` at `c40b8d1b5`: lines = newline count; C = matches of `\bclass\s*=`; B = matches of `<style\b`; I = matches of `\bstyle\s*=`; R = matches of `<(?:button|input|select|textarea|table)\b`. These are lexical counts, including source examples/comments if present; loops are counted once. They measure rewrite exposure, not rendered element counts or DS coverage. T = literal utility styling present in the view's class expressions; inspect the cited first markup line and the remaining class expressions, not just `class="`.

The 24 blobs total **5,735 lines, 282 class assignments, 5 style blocks, 11 inline style assignments and 71 raw-control openings**. Utility styling is present in **22 views**; AgentsList uses semantic classes/DS plus local CSS, and ChatTimeline has no classes. This corrects the plan's “20 of 24” for the per-view dependency inventory: class-expression inspection finds utility styling in the 22 named rows below (including ChatPlacementDropZones:10/:20 and ChatWidgetPager:15/:25). All 24 need a DS composition/authoring check, including the two without utility styling. No assertion of “561 unique tokens” is reproduced using this different measure.

## All package views

The DS column names candidate catalogue primitives. An entry is a composite of those primitives, not a new replacement primitive. `content` means the one sanitised content view plus EX-7 `@sentropic/chat-ui/content.css`, never an app-owned stylesheet. All glyphs become DS icon data; no lucide component import, local style block or utility class survives in Vue sources. Composition dependencies remain exactly those in plan section 6.12.

| View / lot | Lines | T | C/B/I/R | Source markup evidence | DS usage, contract to preserve and unresolved fit |
|---|---|---|---|---|---|
| StreamMessage / C2a | 1153 | yes | 27/1/0/2 | components/StreamMessage.svelte:893 | streaming-message, chat-message, message-status-badge, accordion, code-snippet, icon; content. Keep history/live/passive, summary/lazy details, sanitisation, smooth truncated stream and generated-file callbacks; primitive event shape needs adapter. |
| MessageActions / C2a | 219 | yes | 16/0/0/6 | components/MessageActions.svelte:118 | message-actions, icon, tooltip; translate role/status/last-segment/callback guards into action objects; copy/edit/retry/vote labels and disabled state unchanged. |
| ChatComposer / C2a | 175 | yes | 5/1/1/0 | components/ChatComposer.svelte:114 | chat-composer + ComposerEditor contract and layout slots; preserve rich-content input, auto-grow, paste/keyboard hooks, attachment tray and floating menus. Rich editor/action-fit needs DS review. |
| ChatPanel / C2a | 77 | yes | 5/0/0/0 | components/ChatPanel.svelte:39 | stack/panel-section around renderShell and host slots; preserve empty/default composition and prop flow. No host CSS sizing contract. |
| ChatTimeline / C2a | 25 | no | 0/0/0/0 | components/ChatTimeline.svelte:14 | chat-thread with keyed item slot; disable primitive autoScroll when package follow-bottom/history staging owns scroll. Keep ordering and source scroll ownership. |
| ChatPanelShell / C2b | 844 | yes | 60/1/1/13 | components/ChatPanelShell.svelte:289 | C2a/C4 elements + stack/panel-section, modal, button, structured-list, alert; content. Preserve staged hidden history, permissions/checkpoints/todo, composer and comments; callbacks replace domain knowledge. |
| ChatConversation / C2b | 195 | yes | 12/0/0/11 | components/ChatConversation.svelte:54 | C2a/C4 elements + chat-thread/message/composer, modal/button, file-uploader; content. Retain feature flags and render slots; do not make unsupported host features visible. |
| CommentsPanel / C4 | 520 | yes | 53/0/2/12 | comments/CommentsPanel.svelte:208 | chat-thread/message/composer, menu/select, button/icon-button, selectable-list/row, alert; thread menu and mention list composite. Preserve resolved/current threads, permission gates, count/preview and mention keyboard navigation; A7b editor stays host-injected. |
| AttachmentBand / C4 | 173 | yes | 9/0/0/3 | documents/AttachmentBand.svelte:77 | stack/flex/card, icon-button, tag, inline-loading; name/type/status/thumbnail and remove callback; ready/uploading/failed states. Image/media layout props need DS review. |
| MessageAttachments / C4 | 138 | yes | 10/0/0/1 | documents/MessageAttachments.svelte:45 | grid/card/link/icon-button/icon; open-preview vs download roles, alt names, missing-image fallback and file metadata. |
| ModelSelector / C4 | 123 | yes | 1/0/1/5 | components/ModelSelector.svelte:101 | select; preserve native grouped options, composite key, valid fallback, selected width and onChange pair. DS children slot supplies option/optgroup; Vue option contract must be verified. |
| ContextChips / C4 | 113 | yes | 5/0/0/2 | components/ContextChips.svelte:72 | tag/icon-button/icon + stack; active/removable chips, provider updates and accessible remove/click callbacks. |
| ImageLightbox / C4 | 112 | yes | 7/0/0/2 | documents/ImageLightbox.svelte:40 | modal, icon-button, link, media-content; image alt, close/backdrop/Escape, download and focus restoration. DS modal image sizing/download fit requires review. |
| GeneratedFileCardTray / C4 | 91 | yes | 7/0/0/1 | documents/GeneratedFileCardTray.svelte:34 | card/tag/link/icon-button/icon; format/status/disabled download and preserved filename; host owns retrieval. |
| ChatContextPicker / C4 | 72 | yes | 4/0/1/1 | components/ChatContextPicker.svelte:53 | selectable-list/row, checkbox, icon; keyed labels, active selection, empty state and leading slot. Bounded list-height API must use supported DS sizing. |
| ChatDock / C3 | 614 | yes | 6/0/3/2 | components/ChatDock.svelte:545 | Portal + UtilityPanel/PanelStack, modal/drawer as appropriate, icon-button; retain docked nonmodal vs floating/mobile focus/scroll lock, sidepanel host and layout publication. Geometry/resizing/placement fit requires DS verdict. |
| ChatPlacementMenuButton / C3 | 296 | yes | 7/0/0/2 | components/ChatPlacementMenuButton.svelte:243 | menu/menu-trigger-button, icon; separators, checked placement, disabled/pending options, roving keys and return focus. No hand-built menu. |
| AgentsList / C3 | 225 | no | 8/1/1/0 | components/AgentsList.svelte:75 | existing selectable-list/row, badge, empty-state, icon, overflow-menu, status-dot, tag; remove local CSS/fallback colours/depth inline styling. Hierarchy/indentation props need DS review. |
| ChatSessionsBar / C3 | 152 | yes | 11/0/0/2 | components/ChatSessionsBar.svelte:74 | selectable-list/row or tabs + icon-button/overflow-menu; selection/new/delete confirmation and host menu slots; preserve active item and labels. |
| ChatWidget / C3 | 138 | yes | 10/0/0/1 | components/ChatWidget.svelte:57 | stack/panel-section + C3 TabBar/Pager/AgentsList; preserve optional gates, headers, body slots and absent host features. Immo legacy profile must keep its old chrome. |
| SessionList / C3 | 107 | yes | 7/0/0/2 | components/SessionList.svelte:65 | selectable-list/row, button/icon-button, empty-state, inline-loading; loading, active row and create/select callbacks. |
| ChatWidgetTabBar / C3 | 86 | yes | 5/0/0/3 | components/ChatWidgetTabBar.svelte:42 | tabs, badge/status-dot, icon-button; comments visibility, active panel and job counts; preserve default and extension variants. |
| ChatWidgetPager / C3 | 59 | yes | 5/1/0/0 | components/ChatWidgetPager.svelte:14 | stack/panel-section + DS visibility/transition behaviour; list/conversation switch and polite live announcement; no local animation CSS, honour reduced motion. |
| ChatPlacementDropZones / C3 | 28 | yes | 2/0/1/0 | components/ChatPlacementDropZones.svelte:10 | Portal + DS panel/card/overlay geometry; pointer-transparent, aria-hidden zones keyed by placement AND rectangle index; highlighted target. No new exception is approved: dynamic rectangle positioning needs DS session fit before C3 implements it. |

## Primitive fit: facts versus requests

| Contract at DS pin (D path) | Fact | Required consumer qualification / responsible lot |
|---|---|---|
| ChatMessage.svelte:9 | role/status, avatar, children/content, footer/actions slots; status aliases normalized | C2a: streamed body uses the single content view, actions remain accessible and host bubble profile does not wrap it twice. |
| ChatThread.svelte:16 | label/autoScroll/messages/children/emptyState; :86 renders role log with polite live semantics | C2a/C2b: explicitly control auto-scroll, preserve reading position during summary history hydration; compare announcements with both host profiles. |
| MessageActions.svelte:19 | action array, hover/always visibility and overflow slot; action labels/click/disabled and icon slot | C2a: derive old callback/role/status predicates before supplying DS actions; labels and disabled states match source. |
| MessageStatusBadge.svelte:8 | status, optional tone and per-status labels map; not a stream client | C2a: host/core status mapping retains pending/processing/completed/failed distinctions. |
| StreamingMessage.svelte:55 | accepts initialEvents/events/finalContent/text/mode/showTrail plus footer/actions | C2a: adapt event union; primitive does not replace chat-core projection, subscriptions or neutral sanitising renderer. No extra stream subscription. |
| ChatComposer.svelte:13 | text value, autosize/maxRows, disabled/busy/stoppable, onsubmit/onstop and attachments/actionsLeft/actionsRight | C2a: rich-content/paste/steer/primary button integration is not proven by text props. Review against ComposerEditor contract before implementation; no extra raw input. |
| Select.svelte:5 | bindable value and native children slot | C4: grouped option/fallback pair roundtrip on classic and Vapor; sizing via supported props/tokens. |
| AgentsList.svelte:172 (K) | local depth CSS and hardcoded fallback colour remain despite current DS imports | C3: DS session must review hierarchy sizing. Existing DS import count is not evidence that this view meets DS-3/DS-5. |

Known gap G-2 is already handled by EX-7 owned by C1; no ninth exception is opened. Dock/drop-zone geometry, list depth and rich composer fit are requests for the DS usage review, not assertions of new missing primitives. If they require a new exception or a section-8 choice, the implementing lot must stop and return the evidenced requirement to the conductor. C0 itself neither chooses a new exception nor changes the architecture.

## Required C0 recalibration

The packet expressly requires recomputed Vue-lot agent-hours. These are workload estimates for the existing plan, not human effort, elapsed delivery promises or an adopted schedule. Method: retain the approved source-line-based allocation (22/10/14/14), then add named DS-conversion work omitted by a syntax-only port. Additions below are engineering judgment, rounded to the plan's 2-hour increment, and include the package-bound host UI responsibilities in the ownership ledger. Browser/CI/review/integration overhead remains separate, as in the approved plan. No measured conversion rate exists yet.

| Lot | Approved base | Added DS work (agent-hours) | Recomputed | Acceptance evidence that justifies the addition |
|---|---|---|---|---|
| C2a | 22 | +2: content/stream primitive adapter and composer/editor integration | **24** | Tailwind-free host, incomplete Markdown/citations, lazy stream details, keyboard/paste and action states on both entries. |
| C2b | 10 | +4: two DS compositions plus generic staged-history/scroll/confirmation UI carried by host today | **14** | Both compositions with C2a/C4, upward reading during hydration, checkpoint retry/cancel, permission prompts, absent-feature profile. |
| C3 | 14 | +6: dock/placement geometry (+2), menu/pager/focus composition (+2), agent hierarchy/session/tab restyling (+2) | **20** | Both host profiles, map dock policy, reduced motion, pointer cancel, roving/focus return, no local style/utility/colour fallback. |
| C4 | 14 | +6: comments/thread/mentions (+2), four document/media views (+2), model/context selection contracts (+2) | **20** | Thread/mention keyboard flows, scoped callbacks, grouped model fallback, upload/error/preview/remove/download and lightbox focus. |
| Total | 60 | +18 | **78** | All 24 views retain their approved owner lot; each lot remains within the 24-hour cap. |

This is a **recalibration proposal awaiting DS review and conductor recording**, not a schedule update. Do not increase C1 or A8a/A8b silently: if implementing one of the mapped responsibilities exceeds its approved scope or cap, send the concrete conflict back before coding. C0 does not edit the approved plan or invent new lots. The conductor owns graph/calendar recomputation and the Track write; the increments must not be added a second time as host work.

## Track handoff and acceptance

Parent item from the approved plan: `01M79DW3RDPC2CSCGZJCXC2A81`. Designated writer: s-conductor. Record the C0 deliverables and the 24/14/20/20 recalibration, with link to this table, actual DS review receipt, exact PR head and CI evidence. The recorded fact must distinguish “source inventory complete” from “C0 accepted”. Request DS verdict on every row above and the four fit questions (composer, dock/drop geometry, hierarchy, grouped selection); a completed source audit is not that verdict.

Exit gate remains pending until the DS session has reviewed the column and the designated writer has recorded the recomputed values on that item. The audit needs no DS install, touches neither the Svelte reference nor Vue product code, and leaves all unrelated owner decisions open.
