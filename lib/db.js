// Base de données PostgreSQL via Vercel Postgres
// Remplace l'ancien système en mémoire par une vraie base de données persistante

import { sql } from '@vercel/postgres';
import bcrypt from 'bcrypt';
import logger from './logger.js';

const SALT_ROUNDS = 10;

/**
 * Créer la table users si elle n'existe pas
 * À exécuter une seule fois via /api/setup-db
 */
export async function createUsersTable() {
  try {
    // Créer la table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        subscription_status VARCHAR(50) DEFAULT 'free',
        questions_used INTEGER DEFAULT 0,
        last_question_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Créer les index séparément
    await sql`CREATE INDEX IF NOT EXISTS idx_email ON users(email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_registered_at ON users(registered_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_subscription ON users(subscription_status)`;

    return { success: true, message: 'Table users créée avec succès' };
  } catch (error) {
    logger.error('Erreur création table:', error);
    throw error;
  }
}

/**
 * Créer la table de cache pour les réponses du chatbot
 * À exécuter une seule fois via /api/setup-db
 */
export async function createCacheTable() {
  try {
    // Créer la table
    await sql`
      CREATE TABLE IF NOT EXISTS chat_cache (
        id SERIAL PRIMARY KEY,
        question_hash VARCHAR(64) UNIQUE NOT NULL,
        question_text TEXT NOT NULL,
        answer_text TEXT NOT NULL,
        hit_count INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days')
      )
    `;

    // Créer les index séparément
    await sql`CREATE INDEX IF NOT EXISTS idx_question_hash ON chat_cache(question_hash)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_expires_at ON chat_cache(expires_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_hit_count ON chat_cache(hit_count)`;

    return { success: true, message: 'Table chat_cache créée avec succès' };
  } catch (error) {
    logger.error('Erreur création table cache:', error);
    throw error;
  }
}

/**
 * Ajouter un nouvel utilisateur
 * @param {Object} userData - Données de l'utilisateur
 * @param {string} userData.firstName - Prénom
 * @param {string} userData.lastName - Nom
 * @param {string} userData.email - Email
 * @param {string} [userData.password] - Mot de passe (optionnel pour l'instant)
 * @returns {Object} Utilisateur créé
 */
export async function addUser(userData) {
  try {
    const { firstName, lastName, email, password } = userData;

    // Validation basique
    if (!firstName || !lastName || !email) {
      throw new Error('Tous les champs sont obligatoires');
    }

    // Vérifier si l'utilisateur existe déjà
    const existing = await findUserByEmail(email);
    if (existing) {
      throw new Error('Cet email est déjà utilisé');
    }

    // Hasher le mot de passe si fourni
    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    }

    // Insérer l'utilisateur
    const result = await sql`
      INSERT INTO users (first_name, last_name, email, password_hash)
      VALUES (${firstName}, ${lastName}, ${email}, ${passwordHash})
      RETURNING id, first_name, last_name, email, registered_at, subscription_status
    `;

    const user = result.rows[0];

    logger.logSensitive('Utilisateur ajouté en DB', {
      id: user.id,
      email: user.email,
      timestamp: new Date().toISOString()
    });

    // Mapper les champs snake_case vers camelCase pour compatibilité avec l'API
    return {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      registeredAt: user.registered_at,
      subscriptionStatus: user.subscription_status
    };

  } catch (error) {
    logger.error('Erreur addUser:', error);
    throw error;
  }
}

/**
 * Trouver un utilisateur par email
 * @param {string} email - Email de l'utilisateur
 * @returns {Object|null} Utilisateur trouvé ou null
 */
export async function findUserByEmail(email) {
  try {
    const result = await sql`
      SELECT * FROM users
      WHERE email = ${email}
      LIMIT 1
    `;

    const user = result.rows[0];

    if (!user) return null;

    // Mapper les champs snake_case vers camelCase pour compatibilité avec l'API
    return {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      passwordHash: user.password_hash,
      registeredAt: user.registered_at,
      subscriptionStatus: user.subscription_status,
      questionsUsed: user.questions_used
    };

  } catch (error) {
    logger.error('Erreur findUserByEmail:', error);
    throw error;
  }
}

/**
 * Vérifier le mot de passe d'un utilisateur
 * @param {string} email - Email
 * @param {string} password - Mot de passe à vérifier
 * @returns {Object|null} Utilisateur si mot de passe correct, null sinon
 */
export async function verifyUserPassword(email, password) {
  try {
    const user = await findUserByEmail(email);

    if (!user || !user.passwordHash) {
      return null;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      return null;
    }

    // Ne pas retourner le hash
    const { passwordHash, ...userWithoutPassword } = user;
    return userWithoutPassword;

  } catch (error) {
    logger.error('Erreur verifyUserPassword:', error);
    throw error;
  }
}

/**
 * Récupérer tous les utilisateurs avec pagination
 * @param {number} limit - Nombre d'utilisateurs par page (défaut: 50)
 * @param {number} offset - Offset pour la pagination (défaut: 0)
 * @returns {Array} Liste des utilisateurs
 */
export async function getAllUsers(limit = 50, offset = 0) {
  try {
    const result = await sql`
      SELECT id, first_name, last_name, email, registered_at, subscription_status, questions_used
      FROM users
      ORDER BY registered_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // Mapper les champs snake_case vers camelCase pour compatibilité avec l'API
    return result.rows.map(user => ({
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      registeredAt: user.registered_at,
      subscriptionStatus: user.subscription_status,
      questionsUsed: user.questions_used
    }));

  } catch (error) {
    logger.error('Erreur getAllUsers:', error);
    throw error;
  }
}

/**
 * Compter le nombre total d'utilisateurs
 * @returns {number} Nombre total d'utilisateurs
 */
export async function getUserCount() {
  try {
    const result = await sql`
      SELECT COUNT(*) as count FROM users
    `;

    return parseInt(result.rows[0].count);

  } catch (error) {
    logger.error('Erreur getUserCount:', error);
    throw error;
  }
}

/**
 * Obtenir les statistiques des utilisateurs
 * @returns {Object} Statistiques
 */
export async function getStats() {
  try {
    const result = await sql`
      SELECT
        COUNT(*) as total_users,
        COUNT(CASE WHEN DATE(registered_at) = CURRENT_DATE THEN 1 END) as today_users,
        COUNT(CASE WHEN subscription_status = 'premium' THEN 1 END) as premium_users,
        COUNT(CASE WHEN subscription_status = 'free' THEN 1 END) as free_users
      FROM users
    `;

    const stats = result.rows[0];

    // Récupérer le dernier utilisateur inscrit
    const lastUserResult = await sql`
      SELECT id, first_name, last_name, email, registered_at
      FROM users
      ORDER BY registered_at DESC
      LIMIT 1
    `;

    const lastUser = lastUserResult.rows[0];

    return {
      totalUsers: parseInt(stats.total_users),
      todayUsers: parseInt(stats.today_users),
      premiumUsers: parseInt(stats.premium_users),
      freeUsers: parseInt(stats.free_users),
      lastUser: lastUser ? {
        id: lastUser.id,
        firstName: lastUser.first_name,
        lastName: lastUser.last_name,
        email: lastUser.email,
        registeredAt: lastUser.registered_at
      } : null
    };

  } catch (error) {
    logger.error('Erreur getStats:', error);
    throw error;
  }
}

/**
 * Mettre à jour le statut d'abonnement d'un utilisateur
 * @param {string} email - Email de l'utilisateur
 * @param {string} status - Nouveau statut ('free' ou 'premium')
 * @returns {Object} Utilisateur mis à jour
 */
export async function updateSubscriptionStatus(email, status) {
  try {
    const result = await sql`
      UPDATE users
      SET subscription_status = ${status}, updated_at = CURRENT_TIMESTAMP
      WHERE email = ${email}
      RETURNING id, first_name, last_name, email, subscription_status
    `;

    return result.rows[0];

  } catch (error) {
    logger.error('Erreur updateSubscriptionStatus:', error);
    throw error;
  }
}

/**
 * Incrémenter le compteur de questions d'un utilisateur
 * @param {string} email - Email de l'utilisateur
 * @returns {Object} Utilisateur mis à jour
 */
export async function incrementQuestionCount(email) {
  try {
    const result = await sql`
      UPDATE users
      SET
        questions_used = questions_used + 1,
        last_question_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE email = ${email}
      RETURNING id, email, questions_used, last_question_at
    `;

    return result.rows[0];

  } catch (error) {
    logger.error('Erreur incrementQuestionCount:', error);
    throw error;
  }
}

/**
 * Réinitialiser le compteur de questions (pour les utilisateurs free après 24h)
 * @param {string} email - Email de l'utilisateur
 * @returns {Object} Utilisateur mis à jour
 */
export async function resetQuestionCount(email) {
  try {
    const result = await sql`
      UPDATE users
      SET questions_used = 0, updated_at = CURRENT_TIMESTAMP
      WHERE email = ${email}
      RETURNING id, email, questions_used
    `;

    return result.rows[0];

  } catch (error) {
    logger.error('Erreur resetQuestionCount:', error);
    throw error;
  }
}

// ========================================
// FONCTIONS DE CACHE
// ========================================

/**
 * Générer un hash SHA-256 pour une question (pour le cache)
 * @param {string} question - Question à hasher
 * @returns {Promise<string>} Hash de la question
 */
async function hashQuestion(question) {
  // Normaliser la question (minuscules, trim, espaces multiples)
  const normalized = question.toLowerCase().trim().replace(/\s+/g, ' ');

  // Créer un hash simple en base64 (compatible avec serverless)
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Récupérer une réponse depuis le cache
 * @param {string} question - Question de l'utilisateur
 * @returns {Promise<Object|null>} Réponse cachée ou null
 */
export async function getCachedAnswer(question) {
  try {
    const questionHash = await hashQuestion(question);

    const result = await sql`
      SELECT question_text, answer_text, hit_count, created_at
      FROM chat_cache
      WHERE question_hash = ${questionHash}
        AND expires_at > CURRENT_TIMESTAMP
      LIMIT 1
    `;

    if (result.rows.length === 0) {
      return null;
    }

    // Mettre à jour les stats du cache
    await sql`
      UPDATE chat_cache
      SET hit_count = hit_count + 1,
          last_accessed_at = CURRENT_TIMESTAMP
      WHERE question_hash = ${questionHash}
    `;

    logger.info('Cache HIT:', {
      question: question.substring(0, 50),
      hits: result.rows[0].hit_count + 1
    });

    return {
      answer: result.rows[0].answer_text,
      cached: true,
      hitCount: result.rows[0].hit_count + 1
    };

  } catch (error) {
    logger.error('Erreur getCachedAnswer:', error);
    // En cas d'erreur, on retourne null pour bypass le cache
    return null;
  }
}

/**
 * Sauvegarder une réponse dans le cache
 * @param {string} question - Question de l'utilisateur
 * @param {string} answer - Réponse de l'IA
 * @returns {Promise<void>}
 */
export async function saveCachedAnswer(question, answer) {
  try {
    const questionHash = await hashQuestion(question);

    await sql`
      INSERT INTO chat_cache (question_hash, question_text, answer_text)
      VALUES (${questionHash}, ${question}, ${answer})
      ON CONFLICT (question_hash)
      DO UPDATE SET
        answer_text = ${answer},
        hit_count = chat_cache.hit_count + 1,
        last_accessed_at = CURRENT_TIMESTAMP
    `;

    logger.info('Cache SAVE:', { question: question.substring(0, 50) });

  } catch (error) {
    logger.error('Erreur saveCachedAnswer:', error);
    // Ne pas bloquer si le cache échoue
  }
}

/**
 * Nettoyer les entrées expirées du cache
 * @returns {Promise<number>} Nombre d'entrées supprimées
 */
export async function cleanExpiredCache() {
  try {
    const result = await sql`
      DELETE FROM chat_cache
      WHERE expires_at < CURRENT_TIMESTAMP
      RETURNING id
    `;

    logger.info('Cache nettoyé:', result.rows.length, 'entrées supprimées');
    return result.rows.length;

  } catch (error) {
    logger.error('Erreur cleanExpiredCache:', error);
    throw error;
  }
}

/**
 * Obtenir les statistiques du cache
 * @returns {Promise<Object>} Statistiques du cache
 */
export async function getCacheStats() {
  try {
    const result = await sql`
      SELECT
        COUNT(*) as total_entries,
        SUM(hit_count) as total_hits,
        AVG(hit_count) as avg_hits,
        MAX(hit_count) as max_hits,
        COUNT(CASE WHEN expires_at > CURRENT_TIMESTAMP THEN 1 END) as active_entries
      FROM chat_cache
    `;

    return {
      totalEntries: parseInt(result.rows[0].total_entries) || 0,
      totalHits: parseInt(result.rows[0].total_hits) || 0,
      avgHits: parseFloat(result.rows[0].avg_hits) || 0,
      maxHits: parseInt(result.rows[0].max_hits) || 0,
      activeEntries: parseInt(result.rows[0].active_entries) || 0
    };

  } catch (error) {
    logger.error('Erreur getCacheStats:', error);
    throw error;
  }
}

// ====================================
// GESTION DES CONVERSATIONS
// ====================================

/**
 * Créer les tables pour les conversations
 * À exécuter via /api/setup-db
 */
export async function createConversationTables() {
  try {
    // Table des sessions de conversation
    await sql`
      CREATE TABLE IF NOT EXISTS conversation_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) DEFAULT 'Nouvelle conversation',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        message_count INTEGER DEFAULT 0
      )
    `;

    // Table des messages individuels
    await sql`
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        tokens_used INTEGER DEFAULT 0,
        response_time_ms INTEGER,
        was_cached BOOLEAN DEFAULT FALSE
      )
    `;

    // Créer les index
    await sql`CREATE INDEX IF NOT EXISTS idx_session_user ON conversation_sessions(user_id, last_message_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_session ON conversation_messages(session_id, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_role ON conversation_messages(session_id, role)`;

    logger.info('Tables de conversation créées avec succès');
    return { success: true, message: 'Tables conversation_sessions et conversation_messages créées' };

  } catch (error) {
    logger.error('Erreur création tables conversations:', error);
    throw error;
  }
}

/**
 * Créer une nouvelle session de conversation
 * @param {number} userId - ID de l'utilisateur
 * @param {string} firstQuestion - Première question pour générer le titre
 * @returns {Promise<number>} ID de la session créée
 */
export async function createConversationSession(userId, firstQuestion) {
  try {
    // Générer un titre depuis les 50 premiers caractères de la question
    const title = firstQuestion.substring(0, 50) + (firstQuestion.length > 50 ? '...' : '');

    const result = await sql`
      INSERT INTO conversation_sessions (user_id, title, message_count)
      VALUES (${userId}, ${title}, 0)
      RETURNING id
    `;

    const sessionId = result.rows[0].id;
    logger.debug('Nouvelle session créée:', { sessionId, userId, title });

    return sessionId;

  } catch (error) {
    logger.error('Erreur createConversationSession:', error);
    throw error;
  }
}

/**
 * Ajouter un message à une session de conversation
 * @param {number} sessionId - ID de la session
 * @param {string} role - 'user' ou 'assistant'
 * @param {string} content - Contenu du message
 * @param {Object} metadata - Métadonnées optionnelles
 * @returns {Promise<number>} ID du message créé
 */
export async function addConversationMessage(sessionId, role, content, metadata = {}) {
  try {
    const { tokensUsed = 0, responseTimeMs = null, wasCached = false } = metadata;

    // Insérer le message
    const result = await sql`
      INSERT INTO conversation_messages (session_id, role, content, tokens_used, response_time_ms, was_cached)
      VALUES (${sessionId}, ${role}, ${content}, ${tokensUsed}, ${responseTimeMs}, ${wasCached})
      RETURNING id
    `;

    const messageId = result.rows[0].id;

    // Mettre à jour la session
    await sql`
      UPDATE conversation_sessions
      SET last_message_at = CURRENT_TIMESTAMP,
          message_count = message_count + 1
      WHERE id = ${sessionId}
    `;

    logger.debug('Message ajouté:', { messageId, sessionId, role });

    return messageId;

  } catch (error) {
    logger.error('Erreur addConversationMessage:', error);
    throw error;
  }
}

/**
 * Récupérer toutes les sessions d'un utilisateur
 * @param {number} userId - ID de l'utilisateur
 * @param {number} limit - Nombre maximum de sessions à retourner
 * @returns {Promise<Array>} Liste des sessions
 */
export async function getUserConversationSessions(userId, limit = 20) {
  try {
    const result = await sql`
      SELECT id, title, started_at, last_message_at, message_count
      FROM conversation_sessions
      WHERE user_id = ${userId}
      ORDER BY last_message_at DESC
      LIMIT ${limit}
    `;

    return result.rows.map(row => ({
      id: row.id,
      title: row.title,
      startedAt: row.started_at,
      lastMessageAt: row.last_message_at,
      messageCount: row.message_count
    }));

  } catch (error) {
    logger.error('Erreur getUserConversationSessions:', error);
    throw error;
  }
}

/**
 * Récupérer tous les messages d'une session
 * @param {number} sessionId - ID de la session
 * @param {number} userId - ID de l'utilisateur (pour vérification de propriété)
 * @returns {Promise<Array>} Liste des messages
 */
export async function getSessionMessages(sessionId, userId) {
  try {
    // Vérifier que la session appartient bien à l'utilisateur
    const sessionCheck = await sql`
      SELECT user_id FROM conversation_sessions WHERE id = ${sessionId}
    `;

    if (sessionCheck.rows.length === 0) {
      throw new Error('Session non trouvée');
    }

    if (sessionCheck.rows[0].user_id !== userId) {
      throw new Error('Accès non autorisé à cette session');
    }

    // Récupérer les messages
    const result = await sql`
      SELECT id, role, content, created_at, tokens_used, response_time_ms, was_cached
      FROM conversation_messages
      WHERE session_id = ${sessionId}
      ORDER BY created_at ASC
    `;

    return result.rows.map(row => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      tokensUsed: row.tokens_used,
      responseTimeMs: row.response_time_ms,
      wasCached: row.was_cached
    }));

  } catch (error) {
    logger.error('Erreur getSessionMessages:', error);
    throw error;
  }
}

/**
 * Supprimer une session de conversation
 * @param {number} sessionId - ID de la session
 * @param {number} userId - ID de l'utilisateur (pour vérification)
 * @returns {Promise<boolean>}
 */
export async function deleteConversationSession(sessionId, userId) {
  try {
    const result = await sql`
      DELETE FROM conversation_sessions
      WHERE id = ${sessionId} AND user_id = ${userId}
      RETURNING id
    `;

    if (result.rows.length === 0) {
      throw new Error('Session non trouvée ou non autorisée');
    }

    logger.info('Session supprimée:', { sessionId, userId });
    return true;

  } catch (error) {
    logger.error('Erreur deleteConversationSession:', error);
    throw error;
  }
}

/**
 * Mettre à jour le titre d'une session
 * @param {number} sessionId - ID de la session
 * @param {number} userId - ID de l'utilisateur
 * @param {string} newTitle - Nouveau titre
 * @returns {Promise<boolean>}
 */
export async function updateSessionTitle(sessionId, userId, newTitle) {
  try {
    const result = await sql`
      UPDATE conversation_sessions
      SET title = ${newTitle}
      WHERE id = ${sessionId} AND user_id = ${userId}
      RETURNING id
    `;

    if (result.rows.length === 0) {
      throw new Error('Session non trouvée ou non autorisée');
    }

    logger.debug('Titre de session mis à jour:', { sessionId, newTitle });
    return true;

  } catch (error) {
    logger.error('Erreur updateSessionTitle:', error);
    throw error;
  }
}

/**
 * Obtenir les statistiques de conversation d'un utilisateur
 * @param {number} userId - ID de l'utilisateur
 * @returns {Promise<Object>} Statistiques
 */
export async function getUserConversationStats(userId) {
  try {
    const result = await sql`
      SELECT
        COUNT(DISTINCT cs.id) as total_sessions,
        COUNT(cm.id) as total_messages,
        SUM(cm.tokens_used) as total_tokens,
        COUNT(CASE WHEN cm.was_cached THEN 1 END) as cached_responses
      FROM conversation_sessions cs
      LEFT JOIN conversation_messages cm ON cm.session_id = cs.id
      WHERE cs.user_id = ${userId}
    `;

    const row = result.rows[0];
    return {
      totalSessions: parseInt(row.total_sessions) || 0,
      totalMessages: parseInt(row.total_messages) || 0,
      totalTokens: parseInt(row.total_tokens) || 0,
      cachedResponses: parseInt(row.cached_responses) || 0
    };

  } catch (error) {
    logger.error('Erreur getUserConversationStats:', error);
    throw error;
  }
}
