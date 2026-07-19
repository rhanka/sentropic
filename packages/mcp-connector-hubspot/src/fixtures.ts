/**
 * BR-72 read-only benchmark proof — SYNTHETIC HubSpot fixtures.
 *
 * No real network call, no real data, no PII. Every value below is invented
 * for this proof. Keyed by capability name so the adapter can look up a
 * canned output for `readResource`/`invokeTool` without touching a real API.
 */

export const hubspotFixtures = {
  resources: {
    get_user_details: {
      userDetails: {
        userId: 900001,
        userEmail: 'demo-user@example.invalid',
        hubId: 12345678,
        hubDomain: 'sentropic-demo.hubspot.com',
        scopesGranted: ['crm.objects.contacts.read', 'crm.objects.companies.read', 'crm.objects.deals.read'],
      },
    },
    get_contact: {
      record: {
        id: '3000001',
        archived: false,
        createdAt: '2026-01-05T10:00:00.000Z',
        updatedAt: '2026-06-01T09:30:00.000Z',
        properties: {
          firstname: 'Sentropic',
          lastname: 'Demo Contact',
          email: 'demo-contact@example.invalid',
          lifecyclestage: 'lead',
        },
        propertiesWithHistory: {},
        associations: {},
      },
    },
    get_company: {
      record: {
        id: '4000001',
        archived: false,
        createdAt: '2025-11-20T14:00:00.000Z',
        updatedAt: '2026-05-15T08:45:00.000Z',
        properties: {
          name: 'Sentropic Demo Company',
          domain: 'demo-company.example.invalid',
          industry: 'SOFTWARE',
        },
        propertiesWithHistory: {},
        associations: {},
      },
    },
    get_deal: {
      record: {
        id: '5000001',
        archived: false,
        createdAt: '2026-02-10T12:00:00.000Z',
        updatedAt: '2026-06-20T16:00:00.000Z',
        properties: {
          dealname: 'Sentropic Demo Deal',
          amount: '15000',
          dealstage: 'appointmentscheduled',
          pipeline: 'default',
        },
        propertiesWithHistory: {},
        associations: {},
      },
    },
  },
  tools: {
    search_crm_objects: {
      result: {
        results: [
          {
            id: '3000001',
            archived: false,
            createdAt: '2026-01-05T10:00:00.000Z',
            updatedAt: '2026-06-01T09:30:00.000Z',
            properties: { firstname: 'Sentropic', lastname: 'Demo Contact' },
          },
        ],
        paging: { nextAfter: '' },
      },
    },
    list_properties: {
      properties: [
        {
          name: 'email',
          label: 'Email',
          type: 'string',
          fieldType: 'text',
          description: 'Contact email address.',
          groupName: 'contactinformation',
          options: [],
        },
        {
          name: 'lifecyclestage',
          label: 'Lifecycle Stage',
          type: 'enumeration',
          fieldType: 'select',
          description: 'Contact lifecycle stage.',
          groupName: 'contactinformation',
          options: [],
        },
      ],
    },
    search_owners: {
      result: {
        results: [
          {
            id: '600001',
            email: 'owner-demo@example.invalid',
            firstName: 'Sentropic',
            lastName: 'Owner Demo',
          },
        ],
        paging: { nextAfter: '' },
      },
    },
    get_campaign_analytics: {
      result: {
        campaignId: '700001',
        metricType: 'CONTACTS',
        counters: { sent: 1000, delivered: 980, opened: 420 },
      },
    },
  },
} as const;

export type HubspotResourceCapabilityName = keyof typeof hubspotFixtures.resources;
export type HubspotToolCapabilityName = keyof typeof hubspotFixtures.tools;

export function getResourceFixture(capabilityRef: string): unknown | undefined {
  return (hubspotFixtures.resources as Record<string, unknown>)[capabilityRef];
}

export function getToolFixture(capabilityRef: string): unknown | undefined {
  return (hubspotFixtures.tools as Record<string, unknown>)[capabilityRef];
}
