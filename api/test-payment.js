// Endpoint de test uniquement — bypass paiement Stripe pour tester l'envoi d'emails
// Protégé par ADMIN_KEY, à retirer en production

import logger from '../lib/logger.js';
import { setCorsHeaders, handleCorsPreflight } from '../lib/utils.js';
import { createDropboxFileRequest } from '../lib/dropbox.js';

const NOTIFICATION_EMAIL = 'contact@sos-impots.ai';
const FROM_EMAIL = 'contact@sos-impots.ai';

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.error('RESEND_API_KEY non configuré — email non envoyé');
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error('Erreur envoi email Resend:', err);
  } else {
    logger.info('Email envoyé (test):', { to, subject });
  }
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);
  if (handleCorsPreflight(req, res)) return;

  // Protection par TEST_KEY (clé dédiée aux tests, distincte de ADMIN_KEY)
  const testKey = req.headers['x-admin-key'];
  if (!testKey || testKey !== process.env.TEST_KEY) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, name, offerType } = req.body;

    if (!email || !offerType) {
      return res.status(400).json({ error: 'email et offerType requis' });
    }

    const offerLabel = offerType === 'premium_99' ? 'Analyse Premium IA + Fiscaliste' : 'Analyse Express IA';
    const deliveryDelay = offerType === 'premium_99' ? '48h' : '24h';
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    // Créer le File Request Dropbox
    const dropbox = await createDropboxFileRequest({ clientName: name || email, date });

    const dropboxSection = dropbox
      ? `<p style="margin: 0 0 12px 0;">🔒 <strong>Votre lien :</strong><br>
           <a href="${dropbox.url}" style="color: #1A56DB;">${dropbox.url}</a></p>
         <p style="margin: 0 0 16px 0;">🔑 <strong>Mot de passe :</strong>
           <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${dropbox.password}</code></p>
         <a href="${dropbox.url}" style="display:inline-block;background:#1A56DB;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">📎 Déposer mes documents</a>`
      : `<p style="color:#DC2626;">⚠️ Lien Dropbox non disponible — contacter contact@sos-impots.ai</p>`;

    // Email client
    await sendEmail({
      to: email,
      subject: '[TEST] Votre dossier SOS-IMPOTS.AI — Espace sécurisé',
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;color:#0F1F3D;">
          <div style="background:#0F1F3D;padding:20px 32px;border-radius:8px 8px 0 0;">
            <h1 style="color:white;font-size:20px;margin:0;">SOS-IMPOTS.AI</h1>
          </div>
          <div style="background:#f9fafb;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;">
            <p style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px;padding:8px 12px;font-size:12px;color:#92400E;">
              🧪 Email de test — bypass paiement
            </p>
            <p>Bonjour${name ? ' ' + name : ''},</p>
            <p>Votre <strong>${offerLabel}</strong> est bien enregistrée.</p>
            <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:24px 0;">
              ${dropboxSection}
            </div>
            <p style="font-size:13px;color:#6B7280;">
              Livraison sous <strong>${deliveryDelay} ouvrées</strong>.
            </p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
            <p style="font-size:12px;color:#9CA3AF;margin:0;">L'équipe SOS-IMPOTS.AI — contact@sos-impots.ai</p>
          </div>
        </div>
      `
    });

    // Notification interne
    await sendEmail({
      to: NOTIFICATION_EMAIL,
      subject: '[TEST] Nouvelle commande simulée',
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:600px;color:#0F1F3D;">
          <p style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px;padding:8px 12px;font-size:12px;color:#92400E;">
            🧪 Ceci est un test — aucun paiement réel
          </p>
          <h2 style="font-size:16px;">Commande test</h2>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:8px 0;color:#6B7280;">Email</td><td>${email}</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;">Nom</td><td>${name || 'N/A'}</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;">Offre</td><td>${offerLabel}</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;">Lien Dropbox</td><td>${dropbox ? `<a href="${dropbox.url}">${dropbox.url}</a>` : '⚠️ ÉCHEC'}</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;">Mot de passe</td><td style="font-family:monospace;">${dropbox?.password || 'N/A'}</td></tr>
          </table>
        </div>
      `
    });

    return res.status(200).json({
      success: true,
      dropboxCreated: !!dropbox,
      dropboxUrl: dropbox?.url || null
    });

  } catch (error) {
    logger.error('Erreur test-payment:', error);
    return res.status(500).json({ error: 'Erreur interne' });
  }
}
