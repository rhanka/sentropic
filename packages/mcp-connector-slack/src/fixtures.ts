/**
 * BR-72 Wave-1 benchmark proof — SYNTHETIC Slack fixtures.
 *
 * No real network call, no real data, no PII. Every value below is invented
 * for this proof. Keyed by capability name so the adapter can look up a
 * canned output for `readResource`/`invokeTool` without touching a real API.
 */

const demoConversation = {
  channelId: 'C0SENTROPIC1',
  name: 'general',
  type: 'public_channel',
  isArchived: false,
  isPrivate: false,
  isMember: true,
  memberCount: 12,
  topic: 'Synthetic demo channel topic.',
  purpose: 'Synthetic demo channel purpose.',
};

const demoConversationTwo = {
  channelId: 'C0SENTROPIC2',
  name: 'random',
  type: 'public_channel',
  isArchived: false,
  isPrivate: false,
  isMember: true,
  memberCount: 5,
  topic: 'Synthetic second demo channel topic.',
  purpose: 'Synthetic second demo channel purpose.',
};

const demoUser = {
  userId: 'U0SENTROPIC1',
  username: 'demo.user',
  realName: 'Sentropic Demo User',
  displayName: 'demo-user',
  isBot: false,
  isDeleted: false,
  isAdmin: false,
  isOwner: false,
};

const demoUserTwo = {
  userId: 'U0SENTROPIC2',
  username: 'demo.user.two',
  realName: 'Sentropic Second Demo User',
  displayName: 'demo-user-two',
  isBot: false,
  isDeleted: false,
  isAdmin: false,
  isOwner: false,
};

const demoFile = {
  fileId: 'F0SENTROPIC1',
  name: 'demo-file.txt',
  title: 'Synthetic demo file',
  mimetype: 'text/plain',
  urlPrivate: 'https://files.slack.example.invalid/demo-file.txt',
};

export const slackFixtures = {
  resources: {
    get_conversation: { conversation: demoConversation },
    get_user: { user: demoUser },
    get_file: { file: demoFile },
  },
  tools: {
    list_channels: {
      channels: [
        { channelId: demoConversation.channelId, name: demoConversation.name },
        { channelId: demoConversationTwo.channelId, name: demoConversationTwo.name },
      ],
    },
    list_conversations: {
      conversations: [demoConversation, demoConversationTwo],
      nextCursor: null,
    },
    list_users: {
      users: [demoUser, demoUserTwo],
      nextCursor: null,
    },
    get_channel_messages: {
      messages: [
        { ts: '1700000000.000100', userId: demoUser.userId, text: 'Synthetic demo message one.' },
        { ts: '1700000000.000200', userId: demoUserTwo.userId, text: 'Synthetic demo message two.' },
      ],
      hasMore: false,
    },
    get_thread: {
      messages: [
        { ts: '1700000000.000100', userId: demoUser.userId, text: 'Synthetic parent message.' },
        { ts: '1700000000.000300', userId: demoUserTwo.userId, text: 'Synthetic reply message.' },
      ],
      hasMore: false,
    },
  },
} as const;

export type SlackResourceCapabilityName = keyof typeof slackFixtures.resources;
export type SlackToolCapabilityName = keyof typeof slackFixtures.tools;

export function getResourceFixture(capabilityRef: string): unknown | undefined {
  return (slackFixtures.resources as Record<string, unknown>)[capabilityRef];
}

export function getToolFixture(capabilityRef: string): unknown | undefined {
  return (slackFixtures.tools as Record<string, unknown>)[capabilityRef];
}
