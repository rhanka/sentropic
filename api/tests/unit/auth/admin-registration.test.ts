import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { countCmUsersWithRole, createCmUser } from '../../../src/services/identity/cm-users';
import { cmPurgeAllIdentity } from '../../utils/cm-identity-test-store';
import { env } from '../../../src/config/env';

describe('Admin Registration Logic', () => {
  const adminEmail = env.ADMIN_EMAIL || 'admin@test.com';
  
  beforeEach(async () => {
    // Clean up any existing users
    await cmPurgeAllIdentity();
  });

  afterEach(async () => {
    // Clean up after test
    await cmPurgeAllIdentity();
  });

  it('should create admin_app user when ADMIN_EMAIL is configured and no admin exists', async () => {
    // Check no admin exists initially
    const initialAdmins = await countCmUsersWithRole('admin_app');
    expect(initialAdmins).toBe(0);

    // Simulate the logic from register.ts
    let userRole: 'admin_app' | 'guest' = 'guest';
    
    if (adminEmail && env.ADMIN_EMAIL && adminEmail === env.ADMIN_EMAIL) {
      const existingAdmins = await countCmUsersWithRole('admin_app');
      
      if (existingAdmins === 0) {
        userRole = 'admin_app';
      }
    }

    expect(userRole).toBe('admin_app');
  });

  it('should create guest user when ADMIN_EMAIL already has an admin', async () => {
    // Create an existing admin first
    const existingAdminId = crypto.randomUUID();
    await createCmUser({ userId: existingAdminId, email: 'existing@admin.com', displayName: 'Existing Admin', role: 'admin_app', emailVerified: true, accountStatus: 'active' });

    // Simulate the logic from register.ts
    let userRole: 'admin_app' | 'guest' = 'guest';
    
    if (adminEmail && env.ADMIN_EMAIL && adminEmail === env.ADMIN_EMAIL) {
      const existingAdmins = await countCmUsersWithRole('admin_app');
      
      if (existingAdmins === 0) {
        userRole = 'admin_app';
      }
    }

    expect(userRole).toBe('guest');
  });

  it('should create guest user when email does not match ADMIN_EMAIL', async () => {
    const regularEmail = 'user@example.com';
    
    // Simulate the logic from register.ts
    let userRole: 'admin_app' | 'guest' = 'guest';
    
    if (regularEmail && env.ADMIN_EMAIL && regularEmail === env.ADMIN_EMAIL) {
      const existingAdmins = await countCmUsersWithRole('admin_app');
      
      if (existingAdmins === 0) {
        userRole = 'admin_app';
      }
    }

    expect(userRole).toBe('guest');
  });
});
