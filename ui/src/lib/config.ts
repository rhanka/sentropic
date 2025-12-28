/**
 * Application Configuration
 * 
 * Centralized configuration for the UI application.
 * Uses Vite environment variables with safe fallbacks.
 */

/**
 * API Base URL
 * 
 * Configured via VITE_API_BASE_URL environment variable:
 * - Production: https://top-ai-ideas-api.sent-tech.ca/api/v1 (set in CI/CD)
 * - Development: http://localhost:8787/api/v1 (default fallback)
 * - Docker Compose: http://api:8787/api/v1 (set in docker-compose.yml)
 * 
 * @example
 * ```typescript
 * import { apiGet } from '$lib/utils/api';
 * 
 * const organizations = await apiGet('/organizations');
 * ```
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787/api/v1';

