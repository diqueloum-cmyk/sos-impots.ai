// Base de données PostgreSQL via Vercel Postgres
// Remplace l'ancien système en mémoire par une vraie base de données persistante

import { sql } from '@vercel/postgres';
import logger from './logger.js';

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
        user_id INTEGER,
        title VARCHAR(255) DEFAULT 'Nouvelle conversation',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        message_count INTEGER DEFAULT 0,
        openai_thread_id TEXT
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
    // N'incrémenter message_count que pour les messages utilisateur
    if (role === 'user') {
      await sql`
        UPDATE conversation_sessions
        SET last_message_at = CURRENT_TIMESTAMP,
            message_count = message_count + 1
        WHERE id = ${sessionId}
      `;
    } else {
      await sql`
        UPDATE conversation_sessions
        SET last_message_at = CURRENT_TIMESTAMP
        WHERE id = ${sessionId}
      `;
    }

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
export async function getSessionMessages(sessionId, userId = null) {
  try {
    // Vérifier que la session appartient bien à l'utilisateur (sauf si userId est null pour l'admin)
    const sessionCheck = await sql`
      SELECT user_id FROM conversation_sessions WHERE id = ${sessionId}
    `;

    if (sessionCheck.rows.length === 0) {
      throw new Error('Session non trouvée');
    }

    // Si userId est fourni (utilisateur normal), vérifier qu'il est propriétaire
    if (userId !== null && sessionCheck.rows[0].user_id !== userId) {
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
        COUNT(CASE WHEN cm.role = 'user' THEN 1 END) as total_messages,
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

/**
 * Migration : Ajouter support pour conversations anonymes
 */
export async function migrateConversationTablesForAnonymous() {
  try {
    // 1. Permettre user_id NULL
    await sql`
      ALTER TABLE conversation_sessions
      ALTER COLUMN user_id DROP NOT NULL
    `;

    // 2. Ajouter colonnes pour utilisateurs anonymes
    await sql`
      ALTER TABLE conversation_sessions
      ADD COLUMN IF NOT EXISTS anonymous_identifier VARCHAR(255),
      ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45),
      ADD COLUMN IF NOT EXISTS user_agent TEXT,
      ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE
    `;

    // 3. Créer index pour performance
    await sql`
      CREATE INDEX IF NOT EXISTS idx_anonymous_sessions
      ON conversation_sessions(is_anonymous, last_message_at DESC)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_anonymous_identifier
      ON conversation_sessions(anonymous_identifier)
    `;

    // 4. Marquer sessions existantes comme non-anonymes
    await sql`
      UPDATE conversation_sessions
      SET is_anonymous = FALSE
      WHERE is_anonymous IS NULL
    `;

    logger.info('Migration conversations anonymes réussie');

    return {
      success: true,
      changes: [
        'user_id peut maintenant être NULL',
        'Colonne anonymous_identifier ajoutée (VARCHAR 255)',
        'Colonne ip_address ajoutée (VARCHAR 45)',
        'Colonne user_agent ajoutée (TEXT)',
        'Colonne is_anonymous ajoutée (BOOLEAN)',
        'Index idx_anonymous_sessions créé',
        'Index idx_anonymous_identifier créé',
        'Sessions existantes marquées comme non-anonymes'
      ]
    };
  } catch (error) {
    logger.error('Erreur migration conversations anonymes:', error);
    throw error;
  }
}

/**
 * Créer une session de conversation pour utilisateur anonyme
 */
export async function createAnonymousConversationSession(anonymousId, ipAddress, userAgent, firstQuestion) {
  try {
    const title = firstQuestion.substring(0, 100);
    const now = new Date().toISOString();

    const result = await sql`
      INSERT INTO conversation_sessions (
        user_id,
        anonymous_identifier,
        ip_address,
        user_agent,
        is_anonymous,
        title,
        started_at,
        last_message_at,
        message_count
      )
      VALUES (
        NULL,
        ${anonymousId},
        ${ipAddress},
        ${userAgent},
        TRUE,
        ${title},
        ${now},
        ${now},
        0
      )
      RETURNING id
    `;

    const sessionId = result.rows[0].id;
    logger.info('Session anonyme créée:', { sessionId, anonymousId });

    return sessionId;
  } catch (error) {
    logger.error('Erreur création session anonyme:', error);
    throw error;
  }
}

/**
 * Récupérer les sessions de conversation anonymes avec pagination
 */
export async function getAnonymousConversationSessions(limit = 50, offset = 0, dateFilter = null) {
  try {
    let query;

    // Construire la requête selon le filtre de date
    if (dateFilter === '7d') {
      query = sql`
        SELECT
          id,
          anonymous_identifier,
          ip_address,
          user_agent,
          title,
          started_at,
          last_message_at,
          message_count
        FROM conversation_sessions
        WHERE is_anonymous = TRUE
          AND started_at >= NOW() - INTERVAL '7 days'
        ORDER BY last_message_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
    } else if (dateFilter === '30d') {
      query = sql`
        SELECT
          id,
          anonymous_identifier,
          ip_address,
          user_agent,
          title,
          started_at,
          last_message_at,
          message_count
        FROM conversation_sessions
        WHERE is_anonymous = TRUE
          AND started_at >= NOW() - INTERVAL '30 days'
        ORDER BY last_message_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
    } else {
      query = sql`
        SELECT
          id,
          anonymous_identifier,
          ip_address,
          user_agent,
          title,
          started_at,
          last_message_at,
          message_count
        FROM conversation_sessions
        WHERE is_anonymous = TRUE
        ORDER BY last_message_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
    }

    const result = await query;
    return result.rows;
  } catch (error) {
    logger.error('Erreur récupération sessions anonymes:', error);
    throw error;
  }
}

/**
 * Récupérer le threadId OpenAI d'une session
 * @param {number} sessionId - ID de la session
 * @returns {Promise<string|null>} threadId ou null
 */
export async function getSessionThreadId(sessionId) {
  try {
    const result = await sql`
      SELECT openai_thread_id FROM conversation_sessions WHERE id = ${sessionId}
    `;
    return result.rows[0]?.openai_thread_id || null;
  } catch (error) {
    logger.error('Erreur getSessionThreadId:', error);
    return null;
  }
}

/**
 * Mettre à jour le threadId OpenAI d'une session
 * @param {number} sessionId - ID de la session
 * @param {string} threadId - ID du thread OpenAI
 */
export async function updateSessionThreadId(sessionId, threadId) {
  try {
    await sql`
      UPDATE conversation_sessions SET openai_thread_id = ${threadId} WHERE id = ${sessionId}
    `;
  } catch (error) {
    logger.error('Erreur updateSessionThreadId:', error);
  }
}

/**
 * Migration : Ajouter la colonne openai_thread_id à conversation_sessions
 */
export async function migrateAddOpenaiThreadId() {
  try {
    await sql`
      ALTER TABLE conversation_sessions
      ADD COLUMN IF NOT EXISTS openai_thread_id TEXT
    `;

    logger.info('Migration openai_thread_id réussie');

    return {
      success: true,
      changes: [
        'Colonne openai_thread_id ajoutée à conversation_sessions (TEXT)'
      ]
    };
  } catch (error) {
    logger.error('Erreur migration openai_thread_id:', error);
    throw error;
  }
}

// ====================================
// GESTION DES COMMANDES (ORDERS)
// ====================================

/**
 * Créer la table orders
 */
export async function createOrdersTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES conversation_sessions(id),
        user_email TEXT NOT NULL,
        offer_type TEXT NOT NULL CHECK (offer_type IN ('express_39', 'premium_99', 'avocat_gratuit')),
        stripe_checkout_id TEXT,
        stripe_payment_intent_id TEXT,
        payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
        amount_cents INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(user_email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(payment_status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_orders_stripe_checkout ON orders(stripe_checkout_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_orders_payment_intent ON orders(stripe_payment_intent_id)`;

    logger.info('Table orders créée avec succès');
    return { success: true, message: 'Table orders créée avec succès' };
  } catch (error) {
    logger.error('Erreur création table orders:', error);
    throw error;
  }
}

/**
 * Créer une nouvelle commande
 */
export async function createOrder({ sessionId, userEmail, offerType, stripeCheckoutId = null, stripePaymentIntentId = null, paymentStatus = 'pending', amountCents = null }) {
  const AMOUNT_CENTS = { express_39: 3900, premium_99: 9900, avocat_gratuit: 0 };
  const amount = amountCents ?? AMOUNT_CENTS[offerType] ?? 0;
  try {
    const result = await sql`
      INSERT INTO orders (session_id, user_email, offer_type, stripe_checkout_id, stripe_payment_intent_id, payment_status, amount_cents)
      VALUES (${sessionId || null}, ${userEmail}, ${offerType}, ${stripeCheckoutId}, ${stripePaymentIntentId}, ${paymentStatus}, ${amount})
      RETURNING id
    `;
    logger.info('Commande créée:', { orderId: result.rows[0].id, offerType, userEmail, paymentStatus });
    return result.rows[0].id;
  } catch (error) {
    logger.error('Erreur createOrder:', error);
    throw error;
  }
}

/**
 * Mettre à jour le statut d'une commande via stripe_checkout_id
 */
export async function updateOrderByCheckoutId(stripeCheckoutId, { paymentStatus, stripePaymentIntentId = null }) {
  try {
    await sql`
      UPDATE orders
      SET payment_status = ${paymentStatus},
          stripe_payment_intent_id = COALESCE(${stripePaymentIntentId}, stripe_payment_intent_id),
          updated_at = NOW()
      WHERE stripe_checkout_id = ${stripeCheckoutId}
    `;
    logger.info('Commande mise à jour:', { stripeCheckoutId, paymentStatus });
  } catch (error) {
    logger.error('Erreur updateOrderByCheckoutId:', error);
    throw error;
  }
}

/**
 * Supprimer les sessions anonymes plus vieilles que N jours (et leurs messages en cascade)
 * Ne supprime pas les sessions liées à une commande (orders.session_id)
 * @param {number} daysOld - Nombre de jours (défaut: 30)
 * @returns {Promise<number>} Nombre de sessions supprimées
 */
export async function deleteOldAnonymousSessions(daysOld = 30) {
  try {
    const result = await sql`
      DELETE FROM conversation_sessions
      WHERE is_anonymous = true
        AND last_message_at < NOW() - INTERVAL '1 day' * ${daysOld}
        AND id NOT IN (SELECT session_id FROM orders WHERE session_id IS NOT NULL)
      RETURNING id
    `;
    const deleted = result.rows.length;
    logger.info('Sessions anonymes supprimées:', { deleted, daysOld });
    return deleted;
  } catch (error) {
    logger.error('Erreur deleteOldAnonymousSessions:', error);
    throw error;
  }
}

/**
 * Compter le nombre total de sessions anonymes
 */
export async function countAnonymousConversationSessions(dateFilter = null) {
  try {
    let result;

    if (dateFilter === '7d') {
      result = await sql`
        SELECT COUNT(*) as total
        FROM conversation_sessions
        WHERE is_anonymous = TRUE
          AND started_at >= NOW() - INTERVAL '7 days'
      `;
    } else if (dateFilter === '30d') {
      result = await sql`
        SELECT COUNT(*) as total
        FROM conversation_sessions
        WHERE is_anonymous = TRUE
          AND started_at >= NOW() - INTERVAL '30 days'
      `;
    } else {
      result = await sql`
        SELECT COUNT(*) as total
        FROM conversation_sessions
        WHERE is_anonymous = TRUE
      `;
    }

    return parseInt(result.rows[0].total);
  } catch (error) {
    logger.error('Erreur comptage sessions anonymes:', error);
    throw error;
  }
}

// ====================================
// MAINTENANCE
// ====================================

/**
 * Créer la table site_settings (maintenance, config, etc.)
 */
export async function createSiteSettingsTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS site_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    logger.info('Table site_settings créée / vérifiée');
    return { success: true };
  } catch (error) {
    logger.error('Erreur création table site_settings:', error);
    throw error;
  }
}

/**
 * Lire un paramètre du site
 */
export async function getSiteSetting(key) {
  try {
    const result = await sql`
      SELECT value FROM site_settings WHERE key = ${key}
    `;
    return result.rows.length > 0 ? result.rows[0].value : null;
  } catch (error) {
    // Si la table n'existe pas encore, retourner null silencieusement
    logger.debug('getSiteSetting error (table may not exist):', error.message);
    return null;
  }
}

/**
 * Écrire un paramètre du site (upsert)
 */
export async function setSiteSetting(key, value) {
  try {
    await sql`
      INSERT INTO site_settings (key, value, updated_at)
      VALUES (${key}, ${value}, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = CURRENT_TIMESTAMP
    `;
    return true;
  } catch (error) {
    logger.error('Erreur setSiteSetting:', error);
    throw error;
  }
}

/**
 * Lire l'état complet de la maintenance
 */
export async function getMaintenanceStatus() {
  const enabled = await getSiteSetting('maintenance_enabled');
  const message = await getSiteSetting('maintenance_message');
  const bypassPassword = await getSiteSetting('maintenance_bypass_password');
  return {
    enabled: enabled === 'true',
    message: message || 'Notre site est en cours de maintenance. Nous revenons très vite !',
    bypassPassword: bypassPassword || ''
  };
}

/**
 * Statistiques des commandes
 */
export async function getOrderStats() {
  try {
    const result = await sql`
      SELECT
        COUNT(*) FILTER (WHERE payment_status = 'paid') as total_paid,
        COALESCE(SUM(amount_cents) FILTER (WHERE payment_status = 'paid'), 0) as total_revenue_cents,
        COUNT(*) FILTER (WHERE payment_status = 'paid' AND offer_type = 'express_39') as express_count,
        COUNT(*) FILTER (WHERE payment_status = 'paid' AND offer_type = 'premium_99') as premium_count
      FROM orders
    `;
    const row = result.rows[0];
    return {
      totalPaid: parseInt(row.total_paid) || 0,
      totalRevenue: ((parseInt(row.total_revenue_cents) || 0) / 100).toFixed(2) + ' \u20ac',
      expressCount: parseInt(row.express_count) || 0,
      premiumCount: parseInt(row.premium_count) || 0
    };
  } catch (error) {
    logger.error('Erreur getOrderStats:', error);
    return { totalPaid: 0, totalRevenue: '0.00 \u20ac', expressCount: 0, premiumCount: 0 };
  }
}

/**
 * Créer la table pour stocker les tokens OAuth2 Dropbox
 */
export async function createDropboxTokensTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS dropbox_tokens (
        id SERIAL PRIMARY KEY,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    logger.info('Table dropbox_tokens créée / vérifiée');
    return { success: true };
  } catch (error) {
    logger.error('Erreur création table dropbox_tokens:', error);
    throw error;
  }
}
