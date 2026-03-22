// API Admin - Gestion des conversations
// Endpoint pour visualiser, supprimer et exporter les conversations

import { sql } from '@vercel/postgres';
import { logInfo, sendError, sendSuccess } from '../lib/utils.js';
import {
  getAnonymousConversationSessions,
  countAnonymousConversationSessions,
  deleteOldAnonymousSessions
} from '../lib/db.js';

export default async function handler(req, res) {
  // Vérifier l'authentification admin
  const adminKey = req.headers['x-admin-key'];

  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    logInfo('security', 'Tentative d\'accès admin-conversations sans clé valide');
    return sendError(res, 403, 'Accès refusé');
  }

  const { action, sessionId, page = 1, limit = 50, dateFilter } = req.query;

  try {
    switch(action) {
      case 'list':
        return await handleList(req, res, { page, limit, dateFilter });
      case 'listAnonymous':
        return await handleListAnonymous(req, res, { page, limit, dateFilter });
      case 'messages':
        if (!sessionId) {
          return sendError(res, 400, 'sessionId requis');
        }
        return await handleMessages(req, res, sessionId);
      case 'stats':
        return await handleStats(req, res, dateFilter);
      case 'export':
        return await handleExport(req, res, dateFilter);
      case 'cleanup':
        return await handleCleanup(req, res);
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
 * Statistiques globales des conversations
 */
async function handleStats(req, res, dateFilter) {
  try {
    const totalResult = await sql`
      SELECT COUNT(*) as total FROM conversation_sessions
    `;

    let recentResult;
    if (dateFilter === '7d') {
      recentResult = await sql`
        SELECT COUNT(*) as total FROM conversation_sessions
        WHERE started_at >= NOW() - INTERVAL '7 days'
      `;
    } else if (dateFilter === '30d') {
      recentResult = await sql`
        SELECT COUNT(*) as total FROM conversation_sessions
        WHERE started_at >= NOW() - INTERVAL '30 days'
      `;
    } else {
      recentResult = totalResult;
    }

    const todayResult = await sql`
      SELECT COUNT(*) as total FROM conversation_sessions
      WHERE started_at >= CURRENT_DATE
    `;

    const messagesResult = await sql`
      SELECT COUNT(*) as total FROM conversation_messages
    `;

    return sendSuccess(res, {
      stats: {
        totalSessions: parseInt(totalResult.rows[0].total),
        recentSessions: parseInt(recentResult.rows[0].total),
        todaySessions: parseInt(todayResult.rows[0].total),
        totalMessages: parseInt(messagesResult.rows[0].total)
      }
    });
  } catch (error) {
    logInfo('error', 'Erreur handleStats', { error: error.message });
    return sendError(res, 500, error.message);
  }
}

/**
 * Récupère la liste des conversations avec pagination et filtres
 * Utilise des requêtes paramétrées pour éviter les injections SQL
 */
async function handleList(req, res, { page, limit, dateFilter }) {
  const pageInt = parseInt(page) || 1;
  const limitInt = parseInt(limit) || 50;
  const offset = (pageInt - 1) * limitInt;

  try {
    let result;
    let countResult;

    if (dateFilter === '7d') {
      result = await sql`
        SELECT id, anonymous_identifier, ip_address, title, started_at,
               last_message_at, message_count, is_anonymous
        FROM conversation_sessions
        WHERE started_at >= NOW() - INTERVAL '7 days'
        ORDER BY last_message_at DESC
        LIMIT ${limitInt} OFFSET ${offset}
      `;
      countResult = await sql`
        SELECT COUNT(*) as total FROM conversation_sessions
        WHERE started_at >= NOW() - INTERVAL '7 days'
      `;
    } else if (dateFilter === '30d') {
      result = await sql`
        SELECT id, anonymous_identifier, ip_address, title, started_at,
               last_message_at, message_count, is_anonymous
        FROM conversation_sessions
        WHERE started_at >= NOW() - INTERVAL '30 days'
        ORDER BY last_message_at DESC
        LIMIT ${limitInt} OFFSET ${offset}
      `;
      countResult = await sql`
        SELECT COUNT(*) as total FROM conversation_sessions
        WHERE started_at >= NOW() - INTERVAL '30 days'
      `;
    } else {
      result = await sql`
        SELECT id, anonymous_identifier, ip_address, title, started_at,
               last_message_at, message_count, is_anonymous
        FROM conversation_sessions
        ORDER BY last_message_at DESC
        LIMIT ${limitInt} OFFSET ${offset}
      `;
      countResult = await sql`
        SELECT COUNT(*) as total FROM conversation_sessions
      `;
    }

    const total = parseInt(countResult.rows[0].total);
    const pages = Math.ceil(total / limitInt);

    return sendSuccess(res, {
      sessions: result.rows.map(row => ({
        id: row.id,
        anonymous_identifier: row.anonymous_identifier,
        ip_address: row.ip_address,
        title: row.title || 'Sans titre',
        started_at: row.started_at,
        last_message_at: row.last_message_at,
        message_count: row.message_count || 0,
        is_anonymous: row.is_anonymous
      })),
      total,
      page: pageInt,
      pages
    });
  } catch (error) {
    logInfo('error', 'Erreur handleList', { error: error.message });
    return sendError(res, 500, error.message);
  }
}

/**
 * Récupère la liste des conversations anonymes avec pagination
 */
async function handleListAnonymous(req, res, { page, limit, dateFilter }) {
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const conversations = await getAnonymousConversationSessions(
      parseInt(limit),
      offset,
      dateFilter
    );

    const total = await countAnonymousConversationSessions(dateFilter);

    return sendSuccess(res, {
      conversations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    logInfo('error', 'Erreur handleListAnonymous', { error: error.message });
    return sendError(res, 500, error.message);
  }
}

/**
 * Récupère les messages d'une conversation
 */
async function handleMessages(req, res, sessionId) {
  const sessionIdInt = parseInt(sessionId);
  if (isNaN(sessionIdInt)) {
    return sendError(res, 400, 'sessionId invalide');
  }

  const result = await sql`
    SELECT id, role, content, created_at
    FROM conversation_messages
    WHERE session_id = ${sessionIdInt}
    ORDER BY created_at ASC
  `;

  return sendSuccess(res, { messages: result.rows });
}

/**
 * Supprime une conversation et tous ses messages
 */
async function handleDelete(req, res, sessionId) {
  const sessionIdInt = parseInt(sessionId);
  if (isNaN(sessionIdInt)) {
    return sendError(res, 400, 'sessionId invalide');
  }

  // ON DELETE CASCADE supprime les messages automatiquement
  const result = await sql`
    DELETE FROM conversation_sessions
    WHERE id = ${sessionIdInt}
    RETURNING id
  `;

  if (result.rows.length === 0) {
    return sendError(res, 404, 'Session non trouvée');
  }

  logInfo('info', 'Conversation supprimée par admin', { sessionId: sessionIdInt });

  return sendSuccess(res, {
    message: 'Conversation supprimée avec succès'
  });
}

/**
 * Supprime les sessions anonymes de plus de 30 jours
 */
async function handleCleanup(req, res) {
  const deleted = await deleteOldAnonymousSessions(30);
  logInfo('info', 'Nettoyage sessions anonymes', { deleted });
  return sendSuccess(res, { deleted });
}

/**
 * Exporte les conversations en CSV
 * Utilise des requêtes paramétrées (pas de concaténation SQL)
 */
async function handleExport(req, res, dateFilter) {
  let sessions;

  if (dateFilter === '7d') {
    sessions = await sql`
      SELECT id, title, started_at, anonymous_identifier, is_anonymous
      FROM conversation_sessions
      WHERE started_at >= NOW() - INTERVAL '7 days'
      ORDER BY started_at DESC
    `;
  } else if (dateFilter === '30d') {
    sessions = await sql`
      SELECT id, title, started_at, anonymous_identifier, is_anonymous
      FROM conversation_sessions
      WHERE started_at >= NOW() - INTERVAL '30 days'
      ORDER BY started_at DESC
    `;
  } else {
    sessions = await sql`
      SELECT id, title, started_at, anonymous_identifier, is_anonymous
      FROM conversation_sessions
      ORDER BY started_at DESC
    `;
  }

  // Créer le CSV
  const csvRows = ['Session ID,Type,Identifiant,Date,Titre,Rôle,Message'];

  for (const session of sessions.rows) {
    const messages = await sql`
      SELECT role, content, created_at
      FROM conversation_messages
      WHERE session_id = ${session.id}
      ORDER BY created_at ASC
    `;

    for (const msg of messages.rows) {
      const sessionId = session.id;
      const type = session.is_anonymous ? 'Anonyme' : 'Session';
      const identifier = session.anonymous_identifier
        ? session.anonymous_identifier.substring(0, 8) + '...'
        : 'N/A';
      const date = new Date(session.started_at).toLocaleDateString('fr-FR');
      const title = (session.title || 'Sans titre').replace(/"/g, '""');
      const role = msg.role === 'user' ? 'Question' : 'Réponse';
      const content = (msg.content || '').replace(/"/g, '""').replace(/\n/g, ' ');

      const row = [
        `"${sessionId}"`,
        `"${type}"`,
        `"${identifier}"`,
        `"${date}"`,
        `"${title}"`,
        `"${role}"`,
        `"${content}"`
      ].join(',');

      csvRows.push(row);
    }
  }

  const csv = csvRows.join('\n');
  const filename = `conversations-${dateFilter || 'all'}-${Date.now()}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // BOM UTF-8 pour Excel
  return res.status(200).send('\uFEFF' + csv);
}
