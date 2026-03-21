// Module centralisé Dropbox — OAuth2 avec refresh token automatique
// Remplace l'ancien DROPBOX_ACCESS_TOKEN statique

import { sql } from '@vercel/postgres';
import logger from './logger.js';

/**
 * Récupère un access token valide depuis la BDD.
 * Si le token est expiré, utilise le refresh_token pour en obtenir un nouveau.
 */
async function getValidAccessToken() {
  // 1. Lire le token stocké en BDD
  const { rows } = await sql`
    SELECT access_token, refresh_token, expires_at
    FROM dropbox_tokens
    ORDER BY id DESC LIMIT 1
  `;

  if (rows.length === 0) {
    logger.error('Aucun token Dropbox en BDD — lancer /api/dropbox-auth pour configurer');
    return null;
  }

  const { access_token, refresh_token, expires_at } = rows[0];

  // 2. Si le token n'est pas encore expiré (avec 5 min de marge), l'utiliser
  const now = new Date();
  const expiresAt = new Date(expires_at);
  if (expiresAt > new Date(now.getTime() + 5 * 60 * 1000)) {
    return access_token;
  }

  // 3. Token expiré — le rafraîchir
  logger.info('Token Dropbox expiré, rafraîchissement en cours...');
  return await refreshAccessToken(refresh_token);
}

/**
 * Utilise le refresh_token pour obtenir un nouveau access_token
 */
async function refreshAccessToken(refreshToken) {
  const clientId = process.env.DROPBOX_APP_KEY;
  const clientSecret = process.env.DROPBOX_APP_SECRET;

  if (!clientId || !clientSecret) {
    logger.error('DROPBOX_APP_KEY ou DROPBOX_APP_SECRET manquant');
    return null;
  }

  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error('Erreur refresh token Dropbox:', err);
    return null;
  }

  const data = await response.json();

  // Mettre à jour le token en BDD
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  await sql`
    UPDATE dropbox_tokens
    SET access_token = ${data.access_token},
        expires_at = ${expiresAt.toISOString()},
        updated_at = NOW()
    WHERE id = (SELECT id FROM dropbox_tokens ORDER BY id DESC LIMIT 1)
  `;

  logger.info('Token Dropbox rafraîchi avec succès');
  return data.access_token;
}

/**
 * Stocke les tokens Dropbox initiaux (appelé par le callback OAuth2)
 */
export async function saveDropboxTokens({ accessToken, refreshToken, expiresIn }) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  await sql`
    INSERT INTO dropbox_tokens (access_token, refresh_token, expires_at)
    VALUES (${accessToken}, ${refreshToken}, ${expiresAt.toISOString()})
  `;
  logger.info('Tokens Dropbox sauvegardés en BDD');
}

/**
 * Génère un mot de passe aléatoire de 12 caractères
 */
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * Crée un File Request Dropbox pour le client
 * Retourne { url, password } ou null en cas d'erreur
 */
export async function createDropboxFileRequest({ clientName, date }) {
  const token = await getValidAccessToken();
  if (!token) {
    return null;
  }

  const password = generatePassword();
  const title = `Dossier_${(clientName || 'Client').replace(/\s+/g, '_')}_${date}`;

  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 30);

  const response = await fetch('https://api.dropboxapi.com/2/file_requests/create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title,
      destination: `/Dossiers clients/${title}`,
      deadline: {
        deadline: deadline.toISOString(),
        allow_late_uploads: 'seven_days'
      },
      open: true,
      description: 'Déposez ici vos documents fiscaux de manière sécurisée.'
    })
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error('Erreur création File Request Dropbox:', err);
    return null;
  }

  const data = await response.json();
  logger.info('File Request Dropbox créé:', data.id);

  return { url: data.url, password };
}
