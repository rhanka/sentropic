# Test change register — L-C-shell

Every entry requires independent astra-xhigh review. No timeout, skip or E2E assertion changes are authorized.

| File | Hunk summary | Why | Behavior retained or added |
| --- | --- | --- | --- |
| packages/chat-ui/tests/chat-widget-tab-bar.dom.spec.ts | S1 import in f1a844e76 | Port audited primitive coverage | Order, selection, comments suppression, extension classes and badge policy |
| packages/chat-ui/tests/chat-widget-header-frame.dom.spec.ts | S2 import in f1a844e76 | Port audited header coverage | Default purge, slot order, override purge and pointer handling |
| ui/tests/components/chat/ChatWidget-tab-bar.test.ts | S1 import in f1a844e76 | Port temporary app wiring checks | Labels, plugin suppression, selection and no raw duplicated tabs |
| ui/tests/components/chat/ChatWidget-header-snippets.test.ts | S2 import in f1a844e76 | Port temporary snippet checks | Leading/action controls and app callbacks |
| ui/tests/components/chat/ChatWidget-content-snippets.test.ts | S3 import in f1a844e76 | Port temporary panel checks | Host QueueMonitor, comments and chat controls |
| ui/tests/components/chat/ChatWidget-conversation-seams.test.ts | S4 import in f1a844e76 | Port temporary conversation checks | Sessions menu, icons, Back and chatPanelRef binding |
| packages/chat-ui/tests/chat-conversation.spec.ts | Version literal updated by port | Align package 0.34.0 | Version agreement; all runtime assertions retained |
| packages/chat-ui/tests/chat-core-host.spec.ts | Version literal updated by port | Align package 0.34.0 | Version agreement; all host assertions retained |
| packages/chat-ui/tests/documents-module.spec.ts | Version literal updated by port | Align package 0.34.0 | Version agreement; all document assertions retained |
| packages/chat-ui/tests/chat-widget-pager.dom.spec.ts | Add lifecycle test | Prove S5 hybrid mounting in DOM | List destruction/remount, eligibility, persistent conversation identity/draft, one header/body, live announcements, one subscription |
