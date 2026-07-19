/**
 * BR-72 read-only benchmark proof — Google Calendar connector manifest.
 *
 * READ-ONLY ONLY: every capability declared here is a resource or a
 * read-category tool. No mutation capability is declared in this package
 * (no `./experimental` import, no write tool). This is a recoded proof
 * against the Sentropic `@sentropic/mcp-platform` contract (see
 * `../../mcp-platform/src/manifest.ts`), not the production connector.
 *
 * Capability grounding: taxonomy-only read of the OOMOL googlecalendar
 * provider (`src/providers/googlecalendar/actions.ts` + `scopes.ts`,
 * `authTypes: ["oauth2"]`). Google Calendar exposes ~37 actions in that
 * taxonomy (calendars, calendar-list entries, events, ACL rules, settings,
 * free/busy); this proof recodes 8 representative READ-ONLY ones —
 * `get_calendar`, `get_calendar_list_entry`, `get_event`, `get_acl_rule`
 * (single-entity, URI-addressable → resources) and `list_calendars`,
 * `list_events`, `find_event`, `free_busy_query` (list/search/parameterized
 * reads → read-category tools) — none of the code below is copied or
 * vendored from OOMOL.
 */
import type {
  AppMcpProviderManifest,
  CapabilityGates,
  CapabilityResource,
  CapabilityTool,
} from '../../mcp-platform/src/manifest.js';

// Closed read-only gate set: no elicitation/human-confirmation/principal-gate
// is ever required for a read-only resource or a read-category tool.
const readOnlyGates: CapabilityGates = {
  requiresElicitation: false,
  requiresHumanConfirmation: false,
  requiresPrincipalGate: false,
};

// OOMOL googlecalendarReadScopes / googlecalendarAclReadScopes (taxonomy-only).
const calendarReadScope = 'https://www.googleapis.com/auth/calendar.readonly';
const calendarAclReadScope = 'https://www.googleapis.com/auth/calendar.acls.readonly';

// ---------------------------------------------------------------------------
// Resources (single-entity, URI-addressable reads)
// ---------------------------------------------------------------------------

const getCalendar: CapabilityResource = {
  kind: 'resource',
  name: 'get_calendar',
  uriTemplate: 'googlecalendar://calendars/{calendarId}',
  description: 'Read a single Google Calendar resource by calendar ID.',
  requiredScopes: [calendarReadScope],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getCalendarListEntry: CapabilityResource = {
  kind: 'resource',
  name: 'get_calendar_list_entry',
  uriTemplate: 'googlecalendar://user/calendar-list/{calendarId}',
  description: "Read one entry from the authenticated user's Google Calendar list.",
  requiredScopes: [calendarReadScope],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getEvent: CapabilityResource = {
  kind: 'resource',
  name: 'get_event',
  uriTemplate: 'googlecalendar://calendars/{calendarId}/events/{eventId}',
  description: 'Read a single Google Calendar event by calendar ID and event ID.',
  requiredScopes: [calendarReadScope],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const getAclRule: CapabilityResource = {
  kind: 'resource',
  name: 'get_acl_rule',
  uriTemplate: 'googlecalendar://calendars/{calendarId}/acl/{ruleId}',
  description: 'Read one ACL rule from a Google Calendar.',
  requiredScopes: [calendarAclReadScope],
  requiredClaims: [],
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

// ---------------------------------------------------------------------------
// Tools (read category only — list/search/parameterized reads)
// ---------------------------------------------------------------------------

const listCalendars: CapabilityTool = {
  kind: 'tool',
  name: 'list_calendars',
  description: "List the authenticated user's Google Calendar list entries.",
  requiredScopes: [calendarReadScope],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { maxResults: { type: 'integer' }, pageToken: { type: 'string' } },
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const listEvents: CapabilityTool = {
  kind: 'tool',
  name: 'list_events',
  description: 'List events from a Google Calendar within an optional time window.',
  requiredScopes: [calendarReadScope],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      calendarId: { type: 'string' },
      timeMin: { type: 'string' },
      timeMax: { type: 'string' },
      maxResults: { type: 'integer' },
    },
    required: ['calendarId'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const findEvent: CapabilityTool = {
  kind: 'tool',
  name: 'find_event',
  description: 'Search events in a Google Calendar using a full-text query string.',
  requiredScopes: [calendarReadScope],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' }, calendarId: { type: 'string' } },
    required: ['query'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const freeBusyQuery: CapabilityTool = {
  kind: 'tool',
  name: 'free_busy_query',
  description: 'Query busy intervals for one or more Google Calendars/groups over a time range.',
  requiredScopes: [calendarReadScope],
  requiredClaims: [],
  inputSchema: {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'string' } },
      timeMin: { type: 'string' },
      timeMax: { type: 'string' },
    },
    required: ['items', 'timeMin', 'timeMax'],
  },
  outputSchema: { type: 'object' },
  redactionClass: 'low',
  mutability: 'read-only',
  category: 'read',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

export const googlecalendarManifest: AppMcpProviderManifest = {
  appId: 'sentropic',
  providerId: 'googlecalendar',
  version: '0.0.0',
  displayName: 'Google Calendar (BR-72 read-only benchmark proof)',
  resources: [getCalendar, getCalendarListEntry, getEvent, getAclRule],
  tools: [listCalendars, listEvents, findEvent, freeBusyQuery],
  prompts: [],
  authz: {
    requiredClaims: [],
    scopes: [calendarReadScope, calendarAclReadScope],
    tenantResolution: 'sentropic-account',
  },
  audit: {
    eventKinds: ['read', 'invoke'],
    piiClass: 'moderate',
  },
  durability: {},
  secrets: [
    {
      name: 'googleCalendarAccessToken',
      scope: 'principal',
      sensitive: true,
      rotation: 'provider-driven',
      description: 'Google OAuth2 access token (calendar.readonly / calendar.acls.readonly) — state-only visibility, value never disclosed.',
    },
  ],
};
