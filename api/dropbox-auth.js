// Endpoint pour initier le flow OAuth2 Dropbox
// Utilisation unique : visiter /api/dropbox-auth pour autoriser l'app
// Protégé par SETUP_KEY

export default async function handler(req, res) {
  const setupKey = req.headers['x-setup-key'] || new URL(req.url, 'http://localhost').searchParams.get('key');
  if (setupKey !== process.env.SETUP_KEY) {
    return res.status(403).json({ error: 'Accès interdit — clé SETUP_KEY invalide' });
  }

  const clientId = process.env.DROPBOX_APP_KEY;
  if (!clientId) {
    return res.status(500).json({ error: 'DROPBOX_APP_KEY non configuré dans les variables d\'environnement' });
  }

  // Construire l'URL de base depuis la requête
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${protocol}://${host}/api/dropbox-callback`;

  const authUrl = new URL('https://www.dropbox.com/oauth2/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('token_access_type', 'offline'); // Pour obtenir un refresh_token

  res.writeHead(302, { Location: authUrl.toString() });
  res.end();
}
