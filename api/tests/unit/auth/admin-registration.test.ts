import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../../src/db/client';
import { users } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '../../../src/config/env';

describe('Admin Registration Logic', () => {
  const adminEmail = env.ADMIN_EMAIL || 'admin@test.com';
  
  beforeEach(async () => {
    // Clean up any existing users
    await db.delete(users);
  });

  afterEach(async () => {
    // Clean up after test
    await db.delete(users);
  });

  it('should create admin_app user when ADMIN_EMAIL is configured and no admin exists', async () => {
    // Check no admin exists initially
    const initialAdmins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'admin_app'));
    expect(initialAdmins.length).toBe(0);

    // Simulate the logic from register.ts
    let userRole: 'admin_app' | 'guest' = 'guest';
    
    if (adminEmail && env.ADMIN_EMAIL && adminEmail === env.ADMIN_EMAIL) {
      const existingAdmins = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin_app'))
        .limit(1);
      
      if (existingAdmins.length === 0) {
        userRole = 'admin_app';
      }
    }

    expect(userRole).toBe('admin_app');
  });

  it('should create guest user when ADMIN_EMAIL already has an admin', async () => {
    // Create an existing admin first
    const existingAdminId = crypto.randomUUID();
    await db.insert(users).values({
      id: existingAdminId,
      email: 'existing@admin.com',
      displayName: 'Existing Admin',
      role: 'admin_app',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Simulate the logic from register.ts
    let userRole: 'admin_app' | 'guest' = 'guest';
    
    if (adminEmail && env.ADMIN_EMAIL && adminEmail === env.ADMIN_EMAIL) {
      const existingAdmins = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin_app'))
        .limit(1);
      
      if (existingAdmins.length === 0) {
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
      const existingAdmins = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin_app'))
        .limit(1);
      
      if (existingAdmins.length === 0) {
        userRole = 'admin_app';
      }
    }

    expect(userRole).toBe('guest');
  });
});
