// Webhook Stripe — reçoit les événements de paiement
// Stripe envoie une signature dans le header stripe-signature pour vérifier l'authenticité

import { updateOrderByCheckoutId } from '../lib/db.js';
import logger from '../lib/logger.js';

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
          await updateOrderByCheckoutId(session.id, {
            paymentStatus: 'paid',
            stripePaymentIntentId: session.payment_intent || null
          });
          logger.info('Paiement confirmé pour session:', session.id);
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
