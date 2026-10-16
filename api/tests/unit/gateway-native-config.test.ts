import { describe, expect, it } from 'vitest';
import { gatewayNativeMessagesEnabled } from '../../src/services/llm-runtime/gateway-native-config';

describe('native Messages construction-time switch (N08)', () => {
  it.each([undefined, '', 'disabled', 'ENABLED', 'Enabled', '1', 'true', ' enabled', 'enabled '])(
    'keeps native inference OFF for %j', (value) => {
      expect(gatewayNativeMessagesEnabled(value)).toBe(false);
    });
  it('enables native inference only for the exact operator value', () => {
    expect(gatewayNativeMessagesEnabled('enabled')).toBe(true);
  });
});
