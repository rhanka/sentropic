/**
 * Derive a human-readable display name from an email address.
 * Falls back to the email itself if no better option is available.
 */
export function deriveDisplayNameFromEmail(email: string): string {
  if (!email) {
    return '';
  }

  const normalized = email.trim().toLowerCase();
  const localPart = normalized.split('@')[0] ?? normalized;

  const cleaned = localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return normalized;
  }

  return cleaned
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}


