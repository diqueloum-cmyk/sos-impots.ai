// API pour gérer l'historique des conversations
// GET: Récupérer les sessions ou les messages d'une session
// DELETE: Supprimer une session
// PUT: Mettre à jour le titre d'une session

import { parseCookies, setCorsHeaders, handleCorsPreflight } from '../lib/utils.js';
import {
  findUserByEmail,
  getUserConversationSessions,
  getSessionMessages,
  deleteConversationSession,
  updateSessionTitle,
  getUserConversationStats,
  createConversationSession,
  addConversationMessage
} from '../lib/db.js';
import logger from '../lib/logger.js';

export default async function handler(req, res) {
  // Configurer CORS
  setCorsHeaders(res, req);

  // Gérer preflight CORS
  if (handleCorsPreflight(req, res)) {
    return;
  }

  try {
    // Vérifier l'authentification
    const cookies = parseCookies(req.headers.cookie || '');
    const registered = cookies.registered === '1';
    const userEmail = cookies.user_email;

    if (!registered || !userEmail) {
      return res.status(401).json({
        error: 'Authentification requise',
        message: 'Vous devez être connecté pour accéder à vos conversations'
      });
    }

    // Récupérer l'utilisateur
    const user = await findUserByEmail(userEmail);
    if (!user) {
      return res.status(404).json({
        error: 'Utilisateur non trouvé'
      });
    }

    // ====================================
    // GET: Récupérer les sessions ou messages
    // ====================================
    if (req.method === 'GET') {
      const { sessionId, action } = req.query;

      // Action: stats - Récupérer les statistiques
      if (action === 'stats') {
        const stats = await getUserConversationStats(user.id);
        return res.status(200).json({
          success: true,
          stats
        });
      }

      // Si sessionId fourni, récupérer les messages de cette session
      if (sessionId) {
        const messages = await getSessionMessages(parseInt(sessionId), user.id);
        return res.status(200).json({
          success: true,
          sessionId: parseInt(sessionId),
          messages
        });
      }

      // Sinon, récupérer toutes les sessions de l'utilisateur
      const limit = parseInt(req.query.limit) || 20;
      const sessions = await getUserConversationSessions(user.id, limit);

      return res.status(200).json({
        success: true,
        sessions,
        count: sessions.length
      });
    }

    // ====================================
    // DELETE: Supprimer une session
    // ====================================
    if (req.method === 'DELETE') {
      const { sessionId } = req.query;

      if (!sessionId) {
        return res.status(400).json({
          error: 'sessionId requis'
        });
      }

      await deleteConversationSession(parseInt(sessionId), user.id);

      logger.info('Session supprimée:', { userId: user.id, sessionId });

      return res.status(200).json({
        success: true,
        message: 'Session supprimée avec succès'
      });
    }

    // ====================================
    // POST: Sauvegarder les messages anonymes
    // ====================================
    if (req.method === 'POST') {
      const { action, messages } = req.body;

      if (action === 'saveAnonymous') {
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
          return res.status(400).json({
            error: 'Messages requis'
          });
        }

        // Créer une nouvelle session avec le premier message utilisateur comme titre
        const firstUserMessage = messages.find(m => m.role === 'user');
        const title = firstUserMessage
          ? firstUserMessage.content.substring(0, 50) + (firstUserMessage.content.length > 50 ? '...' : '')
          : 'Conversation anonyme';

        const sessionId = await createConversationSession(user.id, title);

        // Sauvegarder tous les messages dans la session
        for (const msg of messages) {
          await addConversationMessage(
            sessionId,
            msg.role,
            msg.content,
            {
              tokensUsed: 0,
              responseTimeMs: 0,
              wasCached: false
            }
          );
        }

        logger.info('Messages anonymes sauvegardés:', {
          userId: user.id,
          sessionId,
          messageCount: messages.length
        });

        return res.status(200).json({
          success: true,
          sessionId,
          message: 'Messages sauvegardés avec succès'
        });
      }

      return res.status(400).json({
        error: 'Action non reconnue'
      });
    }

    // ====================================
    // PUT: Mettre à jour le titre d'une session
    // ====================================
    if (req.method === 'PUT') {
      const { sessionId, title } = req.body;

      if (!sessionId || !title) {
        return res.status(400).json({
          error: 'sessionId et title requis'
        });
      }

      if (title.length > 255) {
        return res.status(400).json({
          error: 'Le titre ne peut pas dépasser 255 caractères'
        });
      }

      await updateSessionTitle(parseInt(sessionId), user.id, title);

      logger.debug('Titre de session mis à jour:', { userId: user.id, sessionId, title });

      return res.status(200).json({
        success: true,
        message: 'Titre mis à jour avec succès'
      });
    }

    // Méthode non supportée
    return res.status(405).json({
      error: 'Méthode non supportée',
      allowed: ['GET', 'POST', 'DELETE', 'PUT']
    });

  } catch (error) {
    logger.error('Conversations API Error:', error);

    // Gérer les erreurs spécifiques
    if (error.message === 'Session non trouvée' || error.message === 'Accès non autorisé à cette session') {
      return res.status(404).json({
        error: error.message
      });
    }

    return res.status(500).json({
      error: 'Erreur interne du serveur'
    });
  }
}
