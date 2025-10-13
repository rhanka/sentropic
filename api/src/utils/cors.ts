/**
 * Validate if origin matches allowed patterns
 * Supports exact match and wildcard subdomain patterns (*.domain.com)
 */
export function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  for (const pattern of allowedOrigins) {
    // Exact match
    if (pattern === origin) {
      return true;
    }
    
    // Wildcard subdomain match (e.g., *.sent-tech.ca)
    if (pattern.includes('*')) {
      const regexPattern = pattern
        .replace(/\./g, '\\.')  // Escape dots
        .replace(/\*/g, '.*');  // Replace * with .*
      const regex = new RegExp(`^${regexPattern}$`);
      if (regex.test(origin)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Parse allowed origins from comma-separated string
 */
export function parseAllowedOrigins(originsString: string): string[] {
  return originsString.split(',').map(o => o.trim()).filter(o => o.length > 0);
}

