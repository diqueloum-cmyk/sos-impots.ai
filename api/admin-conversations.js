// API Admin - Gestion des conversations
// Endpoint pour visualiser, supprimer et exporter les conversations des utilisateurs

import { sql } from '@vercel/postgres';
import { logInfo, sendError, sendSuccess } from '../lib/utils.js';

export default async function handler(req, res) {
  // Vérifier l'authentification admin
  const adminKey = req.headers['x-admin-key'];

  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    logInfo('security', 'Tentative d\'accès admin-conversations sans clé valide');
    return sendError(res, 403, 'Accès refusé');
  }

  const { action, sessionId, page = 1, limit = 50, dateFilter, userId } = req.query;

  try {
    // Router vers la bonne action
    switch(action) {
      case 'list':
        return await handleList(req, res, { page, limit, dateFilter, userId });
      case 'messages':
        if (!sessionId) {
          return sendError(res, 400, 'sessionId requis');
        }
        return await handleMessages(req, res, sessionId);
      case 'export':
        return await handleExport(req, res, dateFilter);
      default:
        if (req.method === 'DELETE' && sessionId) {
          return await handleDelete(req, res, sessionId);
        }
        return sendError(res, 400, 'Action invalide');
    }
  } catch (error) {
    logInfo('error', 'Erreur admin-conversations', { error: error.message });
    return sendError(res, 500, error.message);
  }
}

/**
 * Récupère la liste des conversations avec pagination et filtres
 */
async function handleList(req, res, { page, limit, dateFilter, userId }) {
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // Construire les conditions WHERE
  let whereConditions = ['1=1'];
  const params = [];

  // Filtre par date
  if (dateFilter === '7d') {
    whereConditions.push("s.started_at >= NOW() - INTERVAL '7 days'");
  } else if (dateFilter === '30d') {
    whereConditions.push("s.started_at >= NOW() - INTERVAL '30 days'");
  }

  // Filtre par utilisateur
  if (userId) {
    whereConditions.push(`s.user_id = ${parseInt(userId)}`);
  }

  const whereClause = whereConditions.join(' AND ');

  // Requête pour récupérer les sessions
  const result = await sql.query(`
    SELECT
      s.id, s.user_id, s.title, s.started_at, s.message_count,
      u.first_name, u.last_name, u.email
    FROM conversation_sessions s
    LEFT JOIN users u ON s.user_id = u.id
    WHERE ${whereClause}
    ORDER BY s.started_at DESC
    LIMIT $1 OFFSET $2
  `, [parseInt(limit), offset]);

  // Compter le total
  const countResult = await sql.query(`
    SELECT COUNT(*) as total
    FROM conversation_sessions s
    WHERE ${whereClause}
  `);

  const total = parseInt(countResult.rows[0].total);
  const pages = Math.ceil(total / parseInt(limit));

  return sendSuccess(res, {
    sessions: result.rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      user_name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
      user_email: row.email || '',
      title: row.title || 'Sans titre',
      started_at: row.started_at,
      message_count: row.message_count || 0
    })),
    total,
    page: parseInt(page),
    pages
  });
}

/**
 * Récupère les messages d'une conversation
 */
async function handleMessages(req, res, sessionId) {
  const result = await sql`
    SELECT id, role, content, created_at
    FROM conversation_messages
    WHERE session_id = ${parseInt(sessionId)}
    ORDER BY created_at ASC
  `;

  return sendSuccess(res, { messages: result.rows });
}

/**
 * Supprime une conversation et tous ses messages
 */
async function handleDelete(req, res, sessionId) {
  const sessionIdInt = parseInt(sessionId);

  // Supprimer les messages de la session
  await sql`
    DELETE FROM conversation_messages
    WHERE session_id = ${sessionIdInt}
  `;

  // Supprimer la session
  await sql`
    DELETE FROM conversation_sessions
    WHERE id = ${sessionIdInt}
  `;

  logInfo('info', 'Conversation supprimée par admin', { sessionId: sessionIdInt });

  return sendSuccess(res, {
    success: true,
    message: 'Conversation supprimée avec succès'
  });
}

/**
 * Exporte les conversations en CSV
 */
async function handleExport(req, res, dateFilter) {
  // Construire la condition de date
  let whereConditions = ['1=1'];

  if (dateFilter === '7d') {
    whereConditions.push("s.started_at >= NOW() - INTERVAL '7 days'");
  } else if (dateFilter === '30d') {
    whereConditions.push("s.started_at >= NOW() - INTERVAL '30 days'");
  }

  const whereClause = whereConditions.join(' AND ');

  // Récupérer toutes les sessions selon le filtre
  const sessions = await sql.query(`
    SELECT
      s.id, s.title, s.started_at,
      u.first_name, u.last_name, u.email
    FROM conversation_sessions s
    LEFT JOIN users u ON s.user_id = u.id
    WHERE ${whereClause}
    ORDER BY s.started_at DESC
  `);

  // Créer le CSV
  const csvRows = ['Session ID,Utilisateur,Email,Date,Titre,Rôle,Message'];

  // Pour chaque session, récupérer les messages
  for (const session of sessions.rows) {
    const messages = await sql`
      SELECT role, content, created_at
      FROM conversation_messages
      WHERE session_id = ${session.id}
      ORDER BY created_at ASC
    `;

    for (const msg of messages.rows) {
      // Échapper les guillemets doubles dans les valeurs
      const sessionId = session.id;
      const userName = `${session.first_name || ''} ${session.last_name || ''}`.trim();
      const userEmail = session.email || '';
      const date = new Date(session.started_at).toLocaleDateString('fr-FR');
      const title = (session.title || 'Sans titre').replace(/"/g, '""');
      const role = msg.role === 'user' ? 'Question' : 'Réponse';
      const content = (msg.content || '').replace(/"/g, '""').replace(/\n/g, ' ');

      const row = [
        `"${sessionId}"`,
        `"${userName}"`,
        `"${userEmail}"`,
        `"${date}"`,
        `"${title}"`,
        `"${role}"`,
        `"${content}"`
      ].join(',');

      csvRows.push(row);
    }
  }

  const csv = csvRows.join('\n');

  // Définir les headers pour le téléchargement CSV
  const filename = `conversations-${dateFilter || 'all'}-${Date.now()}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // Ajouter le BOM UTF-8 pour Excel
  return res.status(200).send('\uFEFF' + csv);
}
