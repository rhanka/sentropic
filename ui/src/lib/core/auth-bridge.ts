/**
 * Auth Bridge — Abstraction layer for authentication, decoupled from SvelteKit.
 *
 * This module provides the interface for authentication handling across
 * SvelteKit (web app) and Chrome Extension environments.
 *
 * Both environments use the same session store (session.ts), which has been
 * refactored to use NavigationAdapter instead of direct `goto` — so this
 * bridge primarily serves as the type contract and extension-aware init hook.
 */

import type { Readable } from 'svelte/store';
import type { SessionState, User } from '$lib/stores/session';

// ---------------------------------------------------------------------------
// Re-export types used by consumers
// ---------------------------------------------------------------------------

export type { SessionState, User };

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface AuthBridge {
    /** Reactive store for session state (user, loading). */
    readonly session: Readable<SessionState>;
    /** Reactive boolean store for auth status. */
    readonly isAuthenticated: Readable<boolean>;
    /** Initialize session (call on bootstrap). */
    initialize(): Promise<void>;
    /** Log out the user. */
    logout(): Promise<void>;
}
