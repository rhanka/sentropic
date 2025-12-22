/**
 * Helper functions to interact with Maildev API for E2E tests
 * 
 * Maildev API documentation: https://github.com/maildev/maildev
 * API endpoints:
 * - GET /email - List all emails
 * - GET /email/:id - Get specific email
 * - DELETE /email/all - Delete all emails
 */

const MAILDEV_API_URL = process.env.MAILDEV_API_URL || 'http://localhost:1080';

interface MaildevEmail {
  id: string;
  to: Array<{ address: string; name?: string }>;
  from: Array<{ address: string; name?: string }>;
  subject: string;
  text: string;
  html: string;
}

/**
 * Get all emails from Maildev
 */
export async function getAllEmails(): Promise<MaildevEmail[]> {
  try {
    const response = await fetch(`${MAILDEV_API_URL}/email`);
    if (!response.ok) {
      throw new Error(`Failed to fetch emails: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    throw new Error(`Error fetching emails from Maildev: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get the latest email for a specific recipient
 */
export async function getLatestEmailForRecipient(email: string): Promise<MaildevEmail | null> {
  const emails = await getAllEmails();
  const recipientEmails = emails.filter(
    (emailItem) => emailItem.to.some((to) => to.address.toLowerCase() === email.toLowerCase())
  );
  
  if (recipientEmails.length === 0) {
    return null;
  }
  
  // Sort by ID (assuming higher ID = more recent)
  recipientEmails.sort((a, b) => parseInt(b.id) - parseInt(a.id));
  return recipientEmails[0];
}

/**
 * Extract verification code from email text
 * Assumes code is 6 digits
 */
export function extractVerificationCode(email: MaildevEmail): string | null {
  // Try to extract from text content
  const textMatch = email.text.match(/\b(\d{6})\b/);
  if (textMatch) {
    return textMatch[1];
  }
  
  // Try to extract from HTML content
  const htmlMatch = email.html.match(/\b(\d{6})\b/);
  if (htmlMatch) {
    return htmlMatch[1];
  }
  
  return null;
}

/**
 * Wait for an email to arrive and extract verification code
 * @param recipientEmail - Email address to wait for
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 30000)
 * @param pollIntervalMs - How often to poll in milliseconds (default: 1000)
 */
export async function waitForVerificationCode(
  recipientEmail: string,
  timeoutMs: number = 30000,
  pollIntervalMs: number = 1000
): Promise<string> {
  const startTime = Date.now();
  
  // Log pour debug
  console.log(`[Maildev] Waiting for verification code for ${recipientEmail} (timeout: ${timeoutMs}ms)`);
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const email = await getLatestEmailForRecipient(recipientEmail);
      
      if (email) {
        console.log(`[Maildev] Found email for ${recipientEmail}, subject: ${email.subject}`);
        const code = extractVerificationCode(email);
        if (code) {
          console.log(`[Maildev] Verification code extracted: ${code}`);
          return code;
        } else {
          console.log(`[Maildev] Email found but no code extracted. Text preview: ${email.text.substring(0, 200)}`);
        }
      } else {
        // Vérifier si Maildev est accessible
        try {
          const allEmails = await getAllEmails();
          console.log(`[Maildev] No email for ${recipientEmail} yet. Total emails in Maildev: ${allEmails.length}`);
        } catch (err) {
          console.error(`[Maildev] Error checking emails: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (error) {
      console.error(`[Maildev] Error in waitForVerificationCode: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  
  // Dernier essai pour voir tous les emails disponibles
  try {
    const allEmails = await getAllEmails();
    console.error(`[Maildev] Timeout reached. Available emails: ${allEmails.length}`);
    allEmails.forEach((email, idx) => {
      console.error(`[Maildev] Email ${idx + 1}: To: ${email.to.map(t => t.address).join(', ')}, Subject: ${email.subject}`);
    });
  } catch (err) {
    console.error(`[Maildev] Could not fetch emails for debugging: ${err instanceof Error ? err.message : String(err)}`);
  }
  
  throw new Error(`Timeout waiting for verification code email to ${recipientEmail}`);
}

/**
 * Extract magic link token from email content.
 * Looks for `token=...` in either text or HTML.
 */
export function extractMagicLinkToken(email: MaildevEmail): string | null {
  const haystacks = [email.text ?? '', email.html ?? ''];
  for (const content of haystacks) {
    const match = content.match(/(?:\?|&|amp;)token=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Wait for an email to arrive and extract magic link token.
 */
export async function waitForMagicLinkToken(
  recipientEmail: string,
  timeoutMs: number = 30_000,
  pollIntervalMs: number = 1000
): Promise<string> {
  const startTime = Date.now();
  console.log(`[Maildev] Waiting for magic link token for ${recipientEmail} (timeout: ${timeoutMs}ms)`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const email = await getLatestEmailForRecipient(recipientEmail);
      if (email) {
        console.log(`[Maildev] Found email for ${recipientEmail}, subject: ${email.subject}`);
        const token = extractMagicLinkToken(email);
        if (token) {
          console.log(`[Maildev] Magic link token extracted (prefix): ${token.slice(0, 8)}...`);
          return token;
        }
      }
    } catch (error) {
      console.error(
        `[Maildev] Error in waitForMagicLinkToken: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timeout waiting for magic link token email to ${recipientEmail}`);
}

/**
 * Delete all emails from Maildev
 */
export async function deleteAllEmails(): Promise<void> {
  try {
    const response = await fetch(`${MAILDEV_API_URL}/email/all`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete emails: ${response.statusText}`);
    }
  } catch (error) {
    throw new Error(`Error deleting emails from Maildev: ${error instanceof Error ? error.message : String(error)}`);
  }
}

