<script lang="ts">
  import { setContext } from 'svelte';
  import { writable } from 'svelte/store';
  import PackageChatWidget from '../../src/components/ChatWidget.svelte';
  import type { ChatWidgetTab } from '../../src/state/chatWidgetShell.js';
  import ChatPanel from './ProductionChatPanelMock.svelte';
  export let extensionChatGateState = { showLoadingState: false, showAuthState: false, blockChatPanel: false };
  export let extensionAuthStatus = 'Auth pending';
  export let extensionWorkspaceOnboardingRequired = false;
  export let extensionWorkspaceOnboardingBusy = false;
  export let extensionWorkspaceOnboardingError = '';
  export let extensionConfigForm = { codeWorkspaces: [] as string[] };
  export let openExtensionSettingsMenu = (_event: Event) => {};
  export let createExtensionCodeWorkspace = () => {};
  export let deferExtensionWorkspaceMapping = () => {};
  export let extensionSettingsTab = 'general';
  export let showExtensionConfigMenu = false;
  export let agentsRows = [];
  export let chatSessionId: string | null = null;
  export let handleSelectAgentsEntry = (_id: string) => {};
  export let handleAgentsAction = (_id: string, _action: string) => {};
  export let formatAgentsRelative = (epoch: number) => `relative:${epoch}`;
  export let labels = (key: string) => `label:${key}`;
  const _ = writable(labels);
  $: _.set(labels);
  export let mount = () => {};
  export let destroy = () => {};
  setContext('composer-lifecycle', { mount, destroy });
  export let activeTab: ChatWidgetTab = 'chat';
  export let agentsView: 'list' | 'conversation' = 'conversation';
  export let canAgentsListBeDefaultView = true;
  const activeJobsCount = 0, failedJobsCount = 0, isPluginMode = false;
  const placementMenuOwnsPlacement = false, headerGripDragging = false;
  const handlePurgeMyJobs = () => {}, onHeaderPointerDown = () => {};
  const agentsViewAnnouncement = '', contextStore = {};
  let chatPanelRef, chatSessions = [], chatDraft = '', chatLoadingSessions = false;
</script>
{#snippet renderHeaderLeadingHost()}<span>Burger</span>{/snippet}
{#snippet renderHeaderActionsHost()}<span>Settings</span>{/snippet}
{#snippet renderJobsPanelHost()}<span>Jobs host</span>{/snippet}
{#snippet renderCommentsPanelHost()}<span>Comments host</span>{/snippet}
{#snippet renderAgentsListHeaderHost()}<span>Scope</span>{/snippet}
{#snippet renderConversationHeaderHost()}<span>Sessions</span>{/snippet}
<!-- production:renderChatBodyHost -->
<!-- production:renderContentGateHost -->
<!-- production:renderAppDockContent -->
{@render renderAppDockContent({ isDocked: false, isMobileViewport: false })}
<output aria-label="Settings state">{extensionSettingsTab}:{showExtensionConfigMenu}</output>
