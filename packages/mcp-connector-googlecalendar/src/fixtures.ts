/**
 * BR-72 read-only benchmark proof — SYNTHETIC Google Calendar fixtures.
 *
 * No real network call, no real data, no PII. Every value below is invented
 * for this proof. Keyed by capability name so the adapter can look up a
 * canned output for `readResource`/`invokeTool` without touching a real API.
 */

export const googlecalendarFixtures = {
  resources: {
    get_calendar: {
      id: 'demo-user@example.invalid',
      summary: 'Sentropic Demo Calendar',
      kind: 'calendar#calendar',
      description: 'Synthetic demo calendar fixture.',
      timeZone: 'America/Toronto',
    },
    get_calendar_list_entry: {
      id: 'demo-user@example.invalid',
      summary: 'Sentropic Demo Calendar',
      accessRole: 'owner',
      primary: true,
      hidden: false,
      selected: true,
      timeZone: 'America/Toronto',
    },
    get_event: {
      id: 'evt-demo-0001',
      status: 'confirmed',
      summary: 'Synthetic demo event',
      description: 'Synthetic demo event fixture.',
      location: 'Virtual',
      htmlLink: 'https://calendar.google.com/event?eid=evt-demo-0001',
      start: { dateTime: '2026-07-20T14:00:00-04:00', timeZone: 'America/Toronto' },
      end: { dateTime: '2026-07-20T14:30:00-04:00', timeZone: 'America/Toronto' },
      attendees: [{ email: 'demo-attendee@example.invalid', responseStatus: 'accepted' }],
    },
    get_acl_rule: {
      id: 'user:demo-collaborator@example.invalid',
      kind: 'calendar#aclRule',
      role: 'reader',
      scope: { type: 'user', value: 'demo-collaborator@example.invalid' },
    },
  },
  tools: {
    list_calendars: {
      items: [
        {
          id: 'demo-user@example.invalid',
          summary: 'Sentropic Demo Calendar',
          accessRole: 'owner',
          primary: true,
        },
        {
          id: 'demo-shared-calendar@example.invalid',
          summary: 'Sentropic Shared Demo Calendar',
          accessRole: 'reader',
          primary: false,
        },
      ],
    },
    list_events: {
      items: [
        {
          id: 'evt-demo-0001',
          status: 'confirmed',
          summary: 'Synthetic demo event',
          start: { dateTime: '2026-07-20T14:00:00-04:00' },
          end: { dateTime: '2026-07-20T14:30:00-04:00' },
        },
        {
          id: 'evt-demo-0002',
          status: 'confirmed',
          summary: 'Synthetic demo standup',
          start: { dateTime: '2026-07-21T09:00:00-04:00' },
          end: { dateTime: '2026-07-21T09:15:00-04:00' },
        },
      ],
    },
    find_event: {
      items: [
        {
          id: 'evt-demo-0001',
          status: 'confirmed',
          summary: 'Synthetic demo event',
          start: { dateTime: '2026-07-20T14:00:00-04:00' },
          end: { dateTime: '2026-07-20T14:30:00-04:00' },
        },
      ],
    },
    free_busy_query: {
      kind: 'calendar#freeBusy',
      timeMin: '2026-07-20T00:00:00-04:00',
      timeMax: '2026-07-21T00:00:00-04:00',
      calendars: {
        'demo-user@example.invalid': {
          busy: [
            { start: '2026-07-20T14:00:00-04:00', end: '2026-07-20T14:30:00-04:00' },
          ],
        },
      },
    },
  },
} as const;

export type GooglecalendarResourceCapabilityName = keyof typeof googlecalendarFixtures.resources;
export type GooglecalendarToolCapabilityName = keyof typeof googlecalendarFixtures.tools;

export function getResourceFixture(capabilityRef: string): unknown | undefined {
  return (googlecalendarFixtures.resources as Record<string, unknown>)[capabilityRef];
}

export function getToolFixture(capabilityRef: string): unknown | undefined {
  return (googlecalendarFixtures.tools as Record<string, unknown>)[capabilityRef];
}
