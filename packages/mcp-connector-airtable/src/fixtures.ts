/**
 * BR-72 Wave-1 benchmark proof — SYNTHETIC Airtable fixtures.
 *
 * No real network call, no real data, no PII. Every value below is invented
 * for this proof. Keyed by capability name so the adapter can look up a
 * canned output for `readResource`/`invokeTool` without touching a real API.
 */

export const airtableFixtures = {
  resources: {
    list_bases: {
      bases: [
        { id: 'appSyntheticDemoBase1', name: 'Sentropic Demo CRM', permissionLevel: 'create' },
        { id: 'appSyntheticDemoBase2', name: 'Sentropic Demo Projects', permissionLevel: 'read' },
      ],
      offset: null,
    },
    get_base_collaborators: {
      base: {
        id: 'appSyntheticDemoBase1',
        createdTime: '2026-01-01T00:00:00.000Z',
        permissionLevel: 'create',
        workspaceId: 'wspSyntheticDemoWorkspace',
        name: 'Sentropic Demo CRM',
      },
    },
    get_base_schema: {
      tables: [
        {
          id: 'tblSyntheticContacts',
          name: 'Contacts',
          primaryFieldId: 'fldSyntheticName',
          fields: [
            { id: 'fldSyntheticName', name: 'Name', type: 'singleLineText' },
            { id: 'fldSyntheticEmail', name: 'Email', type: 'email' },
          ],
          views: [{ id: 'viwSyntheticGrid', name: 'Grid view', type: 'grid' }],
        },
      ],
    },
    get_record: {
      record: {
        id: 'recSyntheticDemoRecord1',
        createdTime: '2026-01-02T00:00:00.000Z',
        fields: {
          Name: 'Sentropic Demo Contact',
          Email: 'demo-contact@example.invalid',
        },
      },
    },
  },
  tools: {
    list_records: {
      records: [
        {
          id: 'recSyntheticDemoRecord1',
          createdTime: '2026-01-02T00:00:00.000Z',
          fields: {
            Name: 'Sentropic Demo Contact',
            Email: 'demo-contact@example.invalid',
          },
        },
        {
          id: 'recSyntheticDemoRecord2',
          createdTime: '2026-01-03T00:00:00.000Z',
          fields: {
            Name: 'Sentropic Second Demo Contact',
            Email: 'demo-contact-2@example.invalid',
          },
        },
      ],
      offset: null,
    },
  },
} as const;

export type AirtableResourceCapabilityName = keyof typeof airtableFixtures.resources;
export type AirtableToolCapabilityName = keyof typeof airtableFixtures.tools;

export function getResourceFixture(capabilityRef: string): unknown | undefined {
  return (airtableFixtures.resources as Record<string, unknown>)[capabilityRef];
}

export function getToolFixture(capabilityRef: string): unknown | undefined {
  return (airtableFixtures.tools as Record<string, unknown>)[capabilityRef];
}
