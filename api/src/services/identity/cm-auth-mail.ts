import type { IdentityDeferredMailV1 } from '@sentropic/cluster-mesh';
import { sendTransactionalEmail } from '../scw-tem-client';

/** Called only after the CM runner acknowledges commit; transport errors contain no proof material. */
export async function sendCmDeferredMail(intent: IdentityDeferredMailV1): Promise<void> {
  try {
    await sendTransactionalEmail(intent.kind === 'code' ? {
      to: intent.email, subject: 'Votre code de vérification Sentropic',
      text: `Bonjour,\n\nVotre code de vérification est : ${intent.code}\n\nCe code est valide pendant 10 minutes.\n\nL'équipe Sentropic`,
      html: `<p>Bonjour,</p><p>Votre code de vérification est : <strong>${intent.code}</strong></p>
        <p>Ce code est valide pendant 10 minutes.</p><p>L'équipe Sentropic</p>`,
    } : { to: intent.email, subject: 'Your Sentropic sign-in link', text: `Sign in: ${intent.url}` });
  } catch { throw new Error('identity_mail_delivery_failed'); }
}
