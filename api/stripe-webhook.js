// Webhook Stripe — reçoit les événements de paiement
// Stripe envoie une signature dans le header stripe-signature pour vérifier l'authenticité

import { createOrder, updateOrderByCheckoutId } from '../lib/db.js';
import { createDropboxFileRequest } from '../lib/dropbox.js';
import logger from '../lib/logger.js';

const NOTIFICATION_EMAIL = 'contact@sos-impots.ai';
const FROM_EMAIL = 'contact@sos-impots.ai';

/**
 * Envoie un email via Resend
 */
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.error('RESEND_API_KEY non configuré — email non envoyé');
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error('Erreur envoi email Resend:', err);
  } else {
    logger.info('Email envoyé à:', to);
  }
}

/**
 * Envoie l'email de confirmation au client avec lien Dropbox
 */
async function sendConfirmationToClient({ email, name, offerType, dropboxUrl, dropboxPassword }) {
  const offerLabel = offerType === 'premium_99' ? 'Analyse Premium IA + Fiscaliste' : 'Analyse Express IA';
  const deliveryDelay = offerType === 'premium_99' ? '48h' : '24h';

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #0F1F3D;">
      <div style="background: #0F1F3D; padding: 24px 32px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; font-size: 20px; margin: 0;">SOS-IMPOTS.AI</h1>
      </div>
      <div style="background: #f9fafb; padding: 32px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
        <p>Bonjour${name ? ' ' + name : ''},</p>
        <p>Merci pour votre commande.<br>
        Votre <strong>${offerLabel}</strong> est bien enregistrée.</p>

        <p>Si vous souhaitez nous transmettre des documents pour affiner votre analyse (courrier reçu, déclarations, justificatifs), vous pouvez les déposer via votre espace sécurisé personnel :</p>

        <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 12px 0;">
            🔒 <strong>Votre lien :</strong><br>
            <a href="${dropboxUrl}" style="color: #1A56DB; word-break: break-all;">${dropboxUrl}</a>
          </p>
          <p style="margin: 0 0 16px 0;">
            🔑 <strong>Mot de passe :</strong> <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 14px;">${dropboxPassword}</code>
          </p>
          <a href="${dropboxUrl}"
             style="display: inline-block; background: #1A56DB; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
            📎 Déposer mes documents
          </a>
        </div>

        <p style="font-size: 14px; color: #374151;">
          Ce dépôt est facultatif mais recommandé — plus votre dossier est documenté, plus notre analyse sera précise et utile.
        </p>

        <p style="font-size: 13px; color: #6B7280;">
          Votre analyse démarre dès réception de votre commande, avec ou sans documents.<br>
          Livraison sous <strong>${deliveryDelay} ouvrées</strong> à cette adresse : <strong>${email}</strong>.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 12px; color: #9CA3AF; margin: 0;">
          L'équipe SOS-IMPOTS.AI — contact@sos-impots.ai
        </p>
      </div>
    </div>
  `;

  await sendEmail({
    to: email,
    subject: 'Votre dossier SOS-IMPOTS.AI — Espace sécurisé pour vos documents',
    html
  });
}

/**
 * Envoie la notification interne à contact@sos-impots.ai
 */
async function sendInternalNotification({ email, name, offerType, amount, sessionId, checkoutId, dropboxUrl, dropboxPassword }) {
  const offerLabel = offerType === 'premium_99' ? 'Premium 99€' : 'Express 39€';
  const amountFormatted = amount ? `${(amount / 100).toFixed(2)}€` : 'N/A';

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; color: #0F1F3D;">
      <h2 style="color: #057A55;">🎉 Nouveau paiement confirmé</h2>
      <table style="border-collapse: collapse; width: 100%;">
        <tr><td style="padding: 8px 0; color: #6B7280;">Client</td><td style="padding: 8px 0; font-weight: 600;">${name || 'N/A'}</td></tr>
        <tr><td style="padding: 8px 0; color: #6B7280;">Email</td><td style="padding: 8px 0;">${email}</td></tr>
        <tr><td style="padding: 8px 0; color: #6B7280;">Offre</td><td style="padding: 8px 0;">${offerLabel}</td></tr>
        <tr><td style="padding: 8px 0; color: #6B7280;">Montant</td><td style="padding: 8px 0;">${amountFormatted}</td></tr>
        <tr><td style="padding: 8px 0; color: #6B7280;">Session</td><td style="padding: 8px 0; font-size: 12px; font-family: monospace;">${sessionId || 'N/A'}</td></tr>
        <tr><td style="padding: 8px 0; color: #6B7280;">Checkout ID</td><td style="padding: 8px 0; font-size: 12px; font-family: monospace;">${checkoutId}</td></tr>
        <tr><td style="padding: 8px 0; color: #6B7280;">Lien Dropbox</td><td style="padding: 8px 0;">${dropboxUrl ? `<a href="${dropboxUrl}" style="color: #1A56DB;">${dropboxUrl}</a>` : '<span style="color: #DC2626;">⚠️ ÉCHEC — File Request non créé (vérifier les tokens Dropbox et les logs Vercel)</span>'}</td></tr>
        <tr><td style="padding: 8px 0; color: #6B7280;">Mot de passe</td><td style="padding: 8px 0; font-family: monospace;">${dropboxPassword || 'N/A'}</td></tr>
      </table>
    </div>
  `;

  await sendEmail({
    to: NOTIFICATION_EMAIL,
    subject: `[SOS-IMPOTS] Nouveau paiement — ${email} — ${offerLabel}`,
    html
  });
}

/**
 * Vérifie la signature Stripe manuellement (sans SDK Stripe)
 * Stripe signe avec HMAC-SHA256 : v1=<timestamp>.<payload>
 */
async function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const parts = {};
  signatureHeader.split(',').forEach(item => {
    const [key, value] = item.split('=');
    parts[key] = value;
  });

  const timestamp = parts.t;
  const signature = parts.v1;

  if (!timestamp || !signature) return false;

  // Tolérance de 5 minutes pour éviter les replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    logger.warn('Stripe webhook timestamp trop ancien:', timestamp);
    return false;
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const macBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expectedSig = Array.from(new Uint8Array(macBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return expectedSig === signature;
}

export const config = {
  api: {
    bodyParser: false // Nécessaire : Stripe a besoin du body brut pour vérifier la signature
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error('STRIPE_WEBHOOK_SECRET non configuré');
    return res.status(500).json({ error: 'Webhook secret manquant' });
  }

  // Lire le body brut
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString('utf8');

  const signature = req.headers['stripe-signature'];
  if (!signature) {
    logger.warn('Webhook Stripe reçu sans signature');
    return res.status(400).json({ error: 'Signature manquante' });
  }

  // Vérifier la signature
  const isValid = await verifyStripeSignature(rawBody, signature, webhookSecret);
  if (!isValid) {
    logger.security('Signature Stripe invalide — webhook rejeté');
    return res.status(400).json({ error: 'Signature invalide' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    logger.error('Impossible de parser l\'événement Stripe:', e.message);
    return res.status(400).json({ error: 'Body invalide' });
  }

  logger.info('Événement Stripe reçu:', { type: event.type, id: event.id });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // Stripe Payment Links utilisent checkout.session.completed
        // session.id = cs_xxx (checkout session ID)
        // session.payment_intent = pi_xxx
        // session.payment_status = 'paid'
        if (session.payment_status === 'paid') {
          // Récupérer les infos client depuis la session Stripe
          const clientEmail = session.customer_details?.email || session.customer_email || null;
          const clientName = session.customer_details?.name || null;
          const amountTotal = session.amount_total || null;

          // Déterminer l'offre depuis les métadonnées ou le montant
          let offerType = session.metadata?.offer_type || null;
          if (!offerType && amountTotal) {
            offerType = amountTotal >= 9900 ? 'premium_99' : 'express_39';
          }

          // Récupérer le sessionId chat depuis client_reference_id (passé dans l'URL du Payment Link)
          const chatSessionId = session.client_reference_id || null;

          // Créer la commande en base (INSERT, pas UPDATE)
          try {
            await createOrder({
              sessionId: chatSessionId ? parseInt(chatSessionId) : null,
              userEmail: clientEmail || `unknown-${session.id}@stripe`,
              offerType: offerType || 'express_39',
              stripeCheckoutId: session.id,
              stripePaymentIntentId: session.payment_intent || null,
              paymentStatus: 'paid',
              amountCents: amountTotal
            });
          } catch (orderError) {
            logger.error('Erreur création commande:', orderError);
            // Continuer quand même pour envoyer les emails
          }

          logger.info('Paiement confirmé pour session:', session.id);

          // Créer le File Request Dropbox
          let dropbox = null;
          try {
            const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            dropbox = await createDropboxFileRequest({ clientName, date });
          } catch (dropboxError) {
            logger.error('Erreur création Dropbox File Request:', dropboxError);
          }

          if (clientEmail) {
            // Envoi en parallèle : email client + notification interne
            await Promise.all([
              sendConfirmationToClient({
                email: clientEmail,
                name: clientName,
                offerType,
                dropboxUrl: dropbox?.url || null,
                dropboxPassword: dropbox?.password || null
              }),
              sendInternalNotification({
                email: clientEmail,
                name: clientName,
                offerType,
                amount: amountTotal,
                sessionId: chatSessionId,
                checkoutId: session.id,
                dropboxUrl: dropbox?.url || null,
                dropboxPassword: dropbox?.password || null
              })
            ]);
          } else {
            // Pas d'email client — envoyer quand même la notification interne
            logger.warn('Pas d\'email client dans la session Stripe:', session.id);
            await sendInternalNotification({
              email: '(email non fourni)',
              name: clientName,
              offerType,
              amount: amountTotal,
              sessionId: chatSessionId,
              checkoutId: session.id,
              dropboxUrl: dropbox?.url || null,
              dropboxPassword: dropbox?.password || null
            });
          }
        }
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object;
        await updateOrderByCheckoutId(session.id, { paymentStatus: 'failed' });
        logger.info('Session Stripe expirée:', session.id);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        // Recherche par payment_intent
        if (charge.payment_intent) {
          const { sql } = await import('@vercel/postgres');
          await sql`
            UPDATE orders
            SET payment_status = 'refunded', updated_at = NOW()
            WHERE stripe_payment_intent_id = ${charge.payment_intent}
          `;
          logger.info('Remboursement enregistré pour payment_intent:', charge.payment_intent);
        }
        break;
      }

      default:
        logger.debug('Événement Stripe ignoré:', event.type);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    logger.error('Erreur traitement webhook Stripe:', error);
    // Retourner 200 quand même pour éviter que Stripe réessaie indéfiniment
    return res.status(200).json({ received: true, warning: 'Erreur interne lors du traitement' });
  }
}
