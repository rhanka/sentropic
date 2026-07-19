/**
 * BR-72 read-only benchmark proof — SYNTHETIC Stripe fixtures.
 *
 * No real network call, no real data, no PII. Every value below is invented
 * for this proof. Keyed by capability name so the adapter can look up a
 * canned output for `readResource`/`invokeTool` without touching a real API.
 */

const DEMO_CUSTOMER = {
  id: 'cus_SentropicDemo001',
  object: 'customer',
  name: 'Ada Demo Lovelace',
  email: 'ada.demo@example.invalid',
  phone: '+15555550100',
  description: 'Synthetic demo customer fixture.',
  balance: 0,
  currency: 'usd',
  address: {
    city: 'Demo City',
    country: 'US',
    line1: '1 Synthetic Way',
    line2: '',
    postal_code: '00000',
    state: 'CA',
  },
  created: 1700000000,
} as const;

const DEMO_PRODUCT = {
  id: 'prod_SentropicDemo001',
  object: 'product',
  name: 'Demo Widget Subscription',
  active: true,
  description: 'Synthetic demo product fixture.',
  created: 1700000000,
} as const;

const DEMO_PRICE = {
  id: 'price_SentropicDemo001',
  object: 'price',
  currency: 'usd',
  unit_amount: 1999,
  active: true,
  product: 'prod_SentropicDemo001',
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
  created: 1700000000,
} as const;

export const stripeFixtures = {
  resources: {
    identify_account: {
      id: 'acct_SentropicDemo00',
      object: 'account',
      email: 'demo-account@example.invalid',
      country: 'US',
      default_currency: 'usd',
      business_profile: { name: 'Sentropic Demo Merchant' },
    },
    get_customer: DEMO_CUSTOMER,
    get_product: DEMO_PRODUCT,
    get_price: DEMO_PRICE,
  },
  tools: {
    list_customers: {
      object: 'list',
      url: '/v1/customers',
      has_more: false,
      data: [DEMO_CUSTOMER],
    },
    search_customers: {
      object: 'search_result',
      url: '/v1/customers/search',
      has_more: false,
      data: [DEMO_CUSTOMER],
    },
    list_products: {
      object: 'list',
      url: '/v1/products',
      has_more: false,
      data: [DEMO_PRODUCT],
    },
    list_prices: {
      object: 'list',
      url: '/v1/prices',
      has_more: false,
      data: [DEMO_PRICE],
    },
  },
} as const;

export type StripeResourceCapabilityName = keyof typeof stripeFixtures.resources;
export type StripeToolCapabilityName = keyof typeof stripeFixtures.tools;

export function getResourceFixture(capabilityRef: string): unknown | undefined {
  return (stripeFixtures.resources as Record<string, unknown>)[capabilityRef];
}

export function getToolFixture(capabilityRef: string): unknown | undefined {
  return (stripeFixtures.tools as Record<string, unknown>)[capabilityRef];
}
