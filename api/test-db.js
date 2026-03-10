// Endpoint de test pour vérifier la connexion à la base de données
// URL: https://votre-site.vercel.app/api/test-db
// Usage: Pour vérifier que Postgres fonctionne correctement

import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  try {
    // Test 1: Connexion basique
    const connectionTest = await sql`SELECT NOW() as current_time`;
    const currentTime = connectionTest.rows[0].current_time;

    return res.status(200).json({
      success: true,
      message: 'Connexion à la base de données réussie',
      timestamp: new Date().toISOString(),
      tests: {
        connection: {
          status: '✅ OK',
          serverTime: currentTime
        }
      }
    });

  } catch (error) {
    console.error('❌ Erreur lors des tests:', error);

    return res.status(500).json({
      success: false,
      error: 'Erreur lors de la vérification de la base de données',
      message: error.message,
      timestamp: new Date().toISOString(),
      help: [
        '1. Vérifiez que Vercel Postgres est configuré',
        '2. Vérifiez que la database est connectée au projet',
        '3. Vérifiez les variables d\'environnement (POSTGRES_URL, etc.)',
        '4. Consultez les logs Vercel pour plus de détails'
      ],
      documentation: 'Voir SETUP_POSTGRES.md pour le guide complet'
    });
  }
}
