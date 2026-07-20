/**
 * BR-72 Wave-1 benchmark proof — SYNTHETIC Notion fixtures.
 *
 * No real network call, no real data, no PII. Every value below is invented
 * for this proof. Keyed by capability name so the adapter can look up a
 * canned output for `readResource`/`invokeTool` without touching a real API.
 */

const now = '2026-07-17T00:00:00.000Z';

export const notionFixtures = {
  resources: {
    retrieve_page: {
      object: 'page',
      id: 'demo-page-0000001',
      created_time: now,
      last_edited_time: now,
      parent: { type: 'data_source_id', data_source_id: 'demo-data-source-0000001' },
      properties: {
        title: { id: 'title', type: 'title', title: [{ plain_text: 'Synthetic demo page' }] },
      },
      url: 'https://www.notion.so/demo-page-0000001',
      archived: false,
      in_trash: false,
    },
    retrieve_database: {
      object: 'database',
      id: 'demo-database-0000001',
      title: [{ plain_text: 'Synthetic demo database' }],
      description: [{ plain_text: 'A synthetic demo database fixture.' }],
      parent: { type: 'page_id', page_id: 'demo-page-0000001' },
      url: 'https://www.notion.so/demo-database-0000001',
      in_trash: false,
    },
    retrieve_data_source: {
      object: 'data_source',
      id: 'demo-data-source-0000001',
      title: [{ plain_text: 'Synthetic demo data source' }],
      properties: {
        Name: { id: 'title', type: 'title' },
        Status: { id: 'status', type: 'select' },
      },
      parent: { type: 'database_id', database_id: 'demo-database-0000001' },
      url: 'https://www.notion.so/demo-data-source-0000001',
      in_trash: false,
    },
    retrieve_user: {
      object: 'user',
      id: 'demo-user-0000001',
      name: 'Sentropic Demo User',
      avatar_url: null,
      type: 'person',
      person: { email: 'demo-user@example.invalid' },
    },
  },
  tools: {
    search: {
      object: 'list',
      results: [
        { object: 'page', id: 'demo-page-0000001', url: 'https://www.notion.so/demo-page-0000001' },
        {
          object: 'data_source',
          id: 'demo-data-source-0000001',
          url: 'https://www.notion.so/demo-data-source-0000001',
        },
      ],
      next_cursor: null,
      has_more: false,
    },
    query_data_source: {
      object: 'list',
      results: [
        {
          object: 'page',
          id: 'demo-page-0000001',
          parent: { type: 'data_source_id', data_source_id: 'demo-data-source-0000001' },
          url: 'https://www.notion.so/demo-page-0000001',
        },
      ],
      next_cursor: null,
      has_more: false,
    },
    list_users: {
      object: 'list',
      results: [
        {
          object: 'user',
          id: 'demo-user-0000001',
          name: 'Sentropic Demo User',
          type: 'person',
          person: { email: 'demo-user@example.invalid' },
        },
        { object: 'user', id: 'demo-bot-0000001', name: 'Sentropic Demo Bot', type: 'bot', bot: {} },
      ],
      next_cursor: null,
      has_more: false,
    },
    list_block_children: {
      object: 'list',
      results: [
        {
          object: 'block',
          id: 'demo-block-0000001',
          parent: { type: 'page_id', page_id: 'demo-page-0000001' },
          type: 'paragraph',
          has_children: false,
          in_trash: false,
        },
      ],
      next_cursor: null,
      has_more: false,
    },
  },
} as const;

export type NotionResourceCapabilityName = keyof typeof notionFixtures.resources;
export type NotionToolCapabilityName = keyof typeof notionFixtures.tools;

export function getResourceFixture(capabilityRef: string): unknown | undefined {
  return (notionFixtures.resources as Record<string, unknown>)[capabilityRef];
}

export function getToolFixture(capabilityRef: string): unknown | undefined {
  return (notionFixtures.tools as Record<string, unknown>)[capabilityRef];
}
