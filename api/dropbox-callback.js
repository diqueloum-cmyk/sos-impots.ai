// Callback OAuth2 Dropbox — reçoit le code d'autorisation et stocke les tokens
// Appelé automatiquement par Dropbox après /api/dropbox-auth

import { saveDropboxTokens } from '../lib/dropbox.js';
import logger from '../lib/logger.js';

export default async function handler(req, res) {
  const { code, error } = req.query || {};

  if (error) {
    logger.error('Erreur OAuth2 Dropbox:', error);
    return res.status(400).json({ error: `Autorisation refusée: ${error}` });
  }

  if (!code) {
    return res.status(400).json({ error: 'Code d\'autorisation manquant' });
  }

  const clientId = process.env.DROPBOX_APP_KEY;
  const clientSecret = process.env.DROPBOX_APP_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'DROPBOX_APP_KEY ou DROPBOX_APP_SECRET manquant' });
  }

  // Reconstruire le redirect_uri (doit correspondre exactement à celui utilisé dans /api/dropbox-auth)
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${protocol}://${host}/api/dropbox-callback`;

  try {
    // Échanger le code contre un access_token + refresh_token
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      })
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error('Erreur échange code Dropbox:', err);
      return res.status(500).json({ error: 'Échec de l\'échange du code OAuth2', details: err });
    }

    const data = await response.json();

    if (!data.refresh_token) {
      logger.error('Pas de refresh_token dans la réponse Dropbox — vérifier token_access_type=offline');
      return res.status(500).json({ error: 'Refresh token non reçu' });
    }

    // Sauvegarder les tokens en BDD
    await saveDropboxTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    });

    logger.info('OAuth2 Dropbox configuré avec succès');
    res.status(200).json({
      success: true,
      message: 'Dropbox connecté avec succès ! Le refresh token est stocké en BDD.',
      expires_in: data.expires_in
    });

  } catch (err) {
    logger.error('Erreur callback Dropbox:', err);
    res.status(500).json({ error: 'Erreur interne lors du callback OAuth2', details: err.message });
  }
}
