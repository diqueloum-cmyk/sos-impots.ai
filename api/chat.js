import crypto from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { parse as parseYaml } from 'yaml';
import { parseCookies, setCorsHeaders, handleCorsPreflight, createCookie } from '../lib/utils.js';
import {
  getCachedAnswer,
  saveCachedAnswer,
  createAnonymousConversationSession,
  addConversationMessage,
  getConversationHistory,
  getMaintenanceStatus
} from '../lib/db.js';
import {
  chatRateLimiter,
  getClientIp,
  checkRateLimit,
  sendRateLimitError,
  addRateLimitHeaders
} from '../lib/ratelimit.js';
import logger from '../lib/logger.js';

// Charger le system prompt depuis agent_console.yaml une seule fois au démarrage
const __dirname = dirname(fileURLToPath(import.meta.url));
const agentConfig = parseYaml(readFileSync(join(__dirname, '..', 'agent_console.yaml'), 'utf-8'));
const systemPrompt = agentConfig.system;

/**
 * Sépare la réponse visible du bloc ---INTERNAL--- et retire [[QUESTION-GRATUITE-UTILISEE]]
 * Le texte brut (avec marqueurs) est conservé dans fullAnswer pour l'historique API.
 */
function parseAgentResponse(fullResponse) {
  const separator = '---INTERNAL---';

  // Retirer [[QUESTION-GRATUITE-UTILISEE]] de l'affichage — conserver dans fullResponse
  let displayText = fullResponse.replace('[[QUESTION-GRATUITE-UTILISEE]]', '').trim();

  const separatorIndex = displayText.indexOf(separator);
  if (separatorIndex === -1) {
    return { visibleResponse: displayText, internalData: null };
  }

  const visibleResponse = displayText.substring(0, separatorIndex).trim();
  const jsonString = displayText.substring(separatorIndex + separator.length).trim();

  let internalData = null;
  try {
    internalData = JSON.parse(jsonString);
  } catch (e) {
    logger.warn('Impossible de parser le bloc INTERNAL:', e.message);
    logger.debug('JSON brut:', jsonString);
  }

  return { visibleResponse, internalData };
}

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (handleCorsPreflight(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Vérifier le mode maintenance
    try {
      const maintenance = await getMaintenanceStatus();
      if (maintenance.enabled) {
        return res.status(503).json({
          error: maintenance.message || 'Site en maintenance. Veuillez réessayer plus tard.'
        });
      }
    } catch {
      // Si la table n'existe pas, on continue normalement
    }

    const { message, sessionId } = req.body;

    logger.info('[DEBUG] Requête reçue:', { message: message?.substring(0, 30), sessionId, sessionIdType: typeof sessionId });

    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // ====================================
    // RATE LIMITING
    // ====================================
    const clientIp = getClientIp(req);
    const cookies = parseCookies(req.headers.cookie || '');

    const rateLimit = await checkRateLimit(chatRateLimiter, clientIp);
    if (!rateLimit.success) {
      logger.security(`Rate limit dépassé pour ${clientIp}`);
      return sendRateLimitError(res, rateLimit);
    }
    addRateLimitHeaders(res, rateLimit);

    // Vérifier que la clé API Anthropic est présente
    if (!process.env.ANTHROPIC_API_KEY) {
      logger.error('ANTHROPIC_API_KEY not found in environment variables');
      return res.status(500).json({
        error: 'Configuration manquante. Veuillez contacter l\'administrateur.'
      });
    }

    const startTime = Date.now();

    // ====================================
    // GESTION IDENTIFIANT ANONYME
    // ====================================
    let anonymousId = cookies.anonymous_session_id;
    let needsAnonymousCookie = false;

    if (!anonymousId) {
      anonymousId = crypto.randomUUID();
      needsAnonymousCookie = true;
      logger.debug('Nouvel identifiant anonyme généré:', anonymousId);
    }

    // ====================================
    // CRÉER OU RÉCUPÉRER LA SESSION
    // ====================================
    let conversationSessionId = sessionId;

    try {
      if (!conversationSessionId) {
        conversationSessionId = await createAnonymousConversationSession(
          anonymousId,
          clientIp,
          req.headers['user-agent'] || 'Unknown',
          message
        );
        logger.debug('Nouvelle session anonyme créée:', conversationSessionId);
      }
    } catch (error) {
      logger.error('Erreur création session:', error);
    }

    // Cache uniquement pour les nouvelles conversations substantielles
    const isNewConversation = !sessionId;
    const isSubstantialMessage = message.trim().length > 30;

    let cachedResponse = null;
    if (isNewConversation && isSubstantialMessage) {
      cachedResponse = await getCachedAnswer(message);
    }

    let answer;
    let fullAnswer;
    let internalData = null;
    let fromCache = false;
    let tokensUsed = 0;

    if (cachedResponse) {
      answer = cachedResponse.answer;
      fromCache = true;
      logger.info('Réponse servie depuis le cache (hit count:', cachedResponse.hitCount, ')');
    } else {
      // Appel Claude API
      try {
        // Récupérer l'historique complet de la session depuis la DB
        const history = conversationSessionId
          ? await getConversationHistory(conversationSessionId)
          : [];

        // Ajouter le message courant à l'historique
        history.push({ role: 'user', content: message });

        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const claudeResponse = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          temperature: 0,
          system: systemPrompt,
          messages: history
        });

        // fullAnswer contient les marqueurs internes — transmis tel quel à l'historique
        fullAnswer = claudeResponse.content[0].text;
        const { visibleResponse, internalData: parsedInternalData } = parseAgentResponse(fullAnswer);
        answer = visibleResponse;
        internalData = parsedInternalData;

        tokensUsed = (claudeResponse.usage?.input_tokens || 0) + (claudeResponse.usage?.output_tokens || 0);

        // Sauvegarder dans le cache uniquement pour les nouvelles conversations sans données internes
        if (isNewConversation && isSubstantialMessage && !internalData) {
          await saveCachedAnswer(message, answer);
        }

        if (internalData) {
          logger.info('Données internes agent reçues:', {
            offre: internalData.offre_choisie,
            email: internalData.email,
            urgence: internalData.urgence
          });
        }

        // Détecter le choix d'offre et préparer l'URL de paiement Stripe
        const STRIPE_LINKS = {
          express_39: 'https://buy.stripe.com/3cIbJ09wqa4i5tMff0ejK00',
          premium_99: 'https://buy.stripe.com/bJe28qfUOa4i2hAff0ejK01'
        };

        let offreKey = internalData?.offre_choisie || null;

        // Fallback : détecter l'offre depuis le texte si ---INTERNAL--- absent ou incomplet
        if (!offreKey || !STRIPE_LINKS[offreKey]) {
          const isConfirmation = answer.includes('bouton de paiement') ||
            answer.includes('Express IA (39') || answer.includes('Premium IA + fiscaliste (99') ||
            answer.includes('sélectionnée');
          if (isConfirmation) {
            if (answer.includes('Express') && answer.includes('39')) offreKey = 'express_39';
            else if (answer.includes('Premium') && answer.includes('99')) offreKey = 'premium_99';
          }
          if (offreKey) logger.info('Offre détectée par fallback texte:', offreKey);
        }

        if (offreKey && STRIPE_LINKS[offreKey]) {
          if (!internalData) internalData = {};
          internalData.offre_choisie = offreKey;
          internalData._paymentUrl = STRIPE_LINKS[offreKey];
        }

      } catch (error) {
        logger.error('Claude API Error:', error);
        return res.status(500).json({
          error: 'Erreur lors de la génération de la réponse. Veuillez réessayer.'
        });
      }
    }

    const responseTimeMs = Date.now() - startTime;

    // ====================================
    // SAUVEGARDER LES MESSAGES DE LA CONVERSATION
    // ====================================
    try {
      if (conversationSessionId) {
        await addConversationMessage(conversationSessionId, 'user', message, {
          tokensUsed: 0,
          responseTimeMs: null,
          wasCached: false
        });

        // Stocker fullAnswer (avec marqueurs) pour que l'historique transmis à Claude soit complet
        const messageToStore = fullAnswer || answer;
        await addConversationMessage(conversationSessionId, 'assistant', messageToStore, {
          tokensUsed,
          responseTimeMs,
          wasCached: fromCache
        });

        logger.info('Conversation sauvegardée:', {
          anonymousId,
          sessionId: conversationSessionId,
          cached: fromCache
        });
      }
    } catch (error) {
      logger.error('Erreur sauvegarde conversation:', error);
    }

    if (needsAnonymousCookie) {
      res.setHeader('Set-Cookie', [
        createCookie('anonymous_session_id', anonymousId, { maxAge: 24 * 60 * 60 })
      ]);
      logger.debug('Cookie anonymous_session_id défini');
    }

    return res.status(200).json({
      success: true,
      response: answer,
      cached: fromCache,
      sessionId: conversationSessionId,
      paymentUrl: internalData?._paymentUrl || null,
      offreChoisie: internalData?.offre_choisie || null
    });

  } catch (error) {
    logger.error('Chat API Error:', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur'
    });
  }
}
