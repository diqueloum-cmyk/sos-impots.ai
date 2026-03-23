import crypto from 'crypto';
import { parseCookies, setCorsHeaders, handleCorsPreflight, createCookie } from '../lib/utils.js';
import {
  getCachedAnswer,
  saveCachedAnswer,
  createAnonymousConversationSession,
  addConversationMessage,
  getSessionThreadId,
  updateSessionThreadId,
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

/**
 * Sépare la réponse visible du bloc ---INTERNAL---
 * @param {string} fullResponse - Réponse complète de l'assistant
 * @returns {{ visibleResponse: string, internalData: object|null }}
 */
/**
 * Supprime les annotations File Search d'OpenAI (ex: 【4:0†fichier.txt】)
 */
function stripFileSearchAnnotations(text) {
  return text.replace(/【[^】]*】/g, '').replace(/ {2,}/g, ' ').trim();
}

function parseAgentResponse(fullResponse) {
  const separator = '---INTERNAL---';
  const separatorIndex = fullResponse.indexOf(separator);

  if (separatorIndex === -1) {
    return { visibleResponse: stripFileSearchAnnotations(fullResponse.trim()), internalData: null };
  }

  const visibleResponse = stripFileSearchAnnotations(fullResponse.substring(0, separatorIndex).trim());
  const jsonString = fullResponse.substring(separatorIndex + separator.length).trim();

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
  // Configurer CORS avec liste blanche
  setCorsHeaders(res, req);

  // Gérer preflight CORS
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

    // Vérifier que la clé API et l'Assistant ID sont présents
    if (!process.env.OPENAI_API_KEY) {
      logger.error('OPENAI_API_KEY not found in environment variables');
      return res.status(500).json({
        error: 'Configuration manquante. Veuillez contacter l\'administrateur.'
      });
    }

    const ASSISTANT_ID = process.env.ASSISTANT_ID;
    if (!ASSISTANT_ID) {
      logger.error('ASSISTANT_ID non configuré');
      return res.status(500).json({ error: 'Configuration manquante.' });
    }

    // Mesurer le temps de réponse
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

    // Vérifier le cache UNIQUEMENT si c'est un nouveau message sans session
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
      // Réponse trouvée dans le cache — nettoyer les éventuelles annotations File Search
      answer = stripFileSearchAnnotations(cachedResponse.answer);
      fromCache = true;
      logger.info('Réponse servie depuis le cache (hit count:', cachedResponse.hitCount, ')');

      // Même en cas de cache, créer un thread OpenAI avec le contexte
      // pour que la suite de la conversation fonctionne
      if (conversationSessionId) {
        try {
          const existingThreadId = await getSessionThreadId(conversationSessionId);
          if (!existingThreadId) {
            const openaiHeaders = {
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
              'OpenAI-Beta': 'assistants=v2'
            };
            // Créer le thread avec la question et la réponse cachée pré-remplies
            const threadResponse = await fetch('https://api.openai.com/v1/threads', {
              method: 'POST',
              headers: openaiHeaders,
              body: JSON.stringify({
                messages: [
                  { role: 'user', content: message },
                  { role: 'assistant', content: answer }
                ]
              })
            });
            if (threadResponse.ok) {
              const threadData = await threadResponse.json();
              await updateSessionThreadId(conversationSessionId, threadData.id);
              logger.debug('Thread OpenAI créé avec contexte cache:', threadData.id);
            }
          }
        } catch (e) {
          logger.warn('Impossible de créer le thread OpenAI pour la réponse en cache:', e.message);
        }
      }
    } else {
      // Pas de cache, utiliser l'Assistant OpenAI
      try {
        const openaiHeaders = {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'assistants=v2'
        };

        // Étape 1: Récupérer ou créer un thread OpenAI
        let threadId = null;

        if (conversationSessionId) {
          threadId = await getSessionThreadId(conversationSessionId);
        }
        logger.info('[DEBUG] Thread récupéré:', { conversationSessionId, threadId });

        if (threadId) {
          // Vérifier que le thread existe toujours (fallback si expiré/supprimé)
          const checkResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}`, {
            headers: openaiHeaders
          });

          if (!checkResponse.ok) {
            logger.warn('Thread OpenAI expiré ou supprimé, création d\'un nouveau:', threadId);
            threadId = null;
          }
        }

        if (!threadId) {
          // Créer un nouveau thread
          const threadResponse = await fetch('https://api.openai.com/v1/threads', {
            method: 'POST',
            headers: openaiHeaders,
            body: JSON.stringify({})
          });

          if (!threadResponse.ok) {
            logger.error('OpenAI Thread Creation Error:', threadResponse.status);
            throw new Error('Erreur lors de la création du thread');
          }

          const threadData = await threadResponse.json();
          threadId = threadData.id;

          // Sauvegarder le threadId dans la session
          if (conversationSessionId) {
            await updateSessionThreadId(conversationSessionId, threadId);
          }

          logger.debug('Nouveau thread OpenAI créé:', threadId);
        } else {
          logger.debug('Thread OpenAI réutilisé:', threadId);
        }

        // Étape 2: Ajouter le message au thread
        const messageResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
          method: 'POST',
          headers: openaiHeaders,
          body: JSON.stringify({
            role: 'user',
            content: message
          })
        });

        if (!messageResponse.ok) {
          logger.error('OpenAI Message Error:', messageResponse.status);
          throw new Error('Erreur lors de l\'ajout du message');
        }

        // Étape 3: Exécuter l'assistant
        const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
          method: 'POST',
          headers: openaiHeaders,
          body: JSON.stringify({
            assistant_id: ASSISTANT_ID,
            temperature: 0.3
          })
        });

        if (!runResponse.ok) {
          logger.error('OpenAI Run Error:', runResponse.status);
          throw new Error('Erreur lors de l\'exécution de l\'assistant');
        }

        const runData = await runResponse.json();
        const runId = runData.id;

        // Étape 4: Attendre que l'exécution soit terminée (polling)
        let runStatus = 'queued';
        let attempts = 0;
        const maxAttempts = 60; // 60 secondes maximum (augmenté pour les assistants)

        while (runStatus !== 'completed' && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Attendre 1 seconde

          const statusResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
            headers: {
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
              'OpenAI-Beta': 'assistants=v2'
            }
          });

          if (!statusResponse.ok) {
            logger.error('OpenAI Status Check Error:', statusResponse.status);
            throw new Error('Erreur lors de la vérification du statut');
          }

          const statusData = await statusResponse.json();
          runStatus = statusData.status;

          logger.debug(`Assistant run status (attempt ${attempts}):`, runStatus);

          if (runStatus === 'failed' || runStatus === 'cancelled' || runStatus === 'expired') {
            logger.error('Assistant run failed with status:', runStatus, 'Details:', statusData);
            throw new Error('L\'assistant n\'a pas pu traiter la demande');
          }

          attempts++;
        }

        if (runStatus !== 'completed') {
          logger.error('Assistant timeout after', attempts, 'attempts. Last status:', runStatus);
          throw new Error('Timeout: L\'assistant met trop de temps à répondre');
        }

        // Étape 5: Récupérer les messages du thread
        const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'OpenAI-Beta': 'assistants=v2'
          }
        });

        if (!messagesResponse.ok) {
          logger.error('OpenAI Messages Retrieval Error:', messagesResponse.status);
          throw new Error('Erreur lors de la récupération des messages');
        }

        const messagesData = await messagesResponse.json();

        // Récupérer le dernier message de l'assistant
        const assistantMessage = messagesData.data.find(msg => msg.role === 'assistant');

        if (!assistantMessage || !assistantMessage.content || assistantMessage.content.length === 0) {
          throw new Error('Aucune réponse de l\'assistant');
        }

        fullAnswer = assistantMessage.content[0].text.value;
        const { visibleResponse, internalData: parsedInternalData } = parseAgentResponse(fullAnswer);
        answer = visibleResponse;
        internalData = parsedInternalData;

        // Estimer les tokens (approximation basée sur la longueur)
        tokensUsed = Math.ceil((message.length + fullAnswer.length) / 4);

        // Sauvegarder dans le cache UNIQUEMENT pour les nouvelles conversations
        if (isNewConversation && isSubstantialMessage && !internalData) {
          await saveCachedAnswer(message, visibleResponse);
        }

        // Logger les données internes si présentes
        if (internalData) {
          logger.info('Données internes agent reçues:', {
            offre: internalData.offre_choisie,
            email: internalData.email,
            urgence: internalData.urgence
          });
        }

        // Détecter le choix d'offre et préparer l'URL de paiement
        if (internalData && internalData.offre_choisie) {
          const STRIPE_LINKS = {
            express_39: 'https://buy.stripe.com/3cIbJ09wqa4i5tMff0ejK00',
            premium_99: 'https://buy.stripe.com/bJe28qfUOa4i2hAff0ejK01'
          };
          const paymentUrl = STRIPE_LINKS[internalData.offre_choisie];
          if (paymentUrl) {
            internalData._paymentUrl = paymentUrl;
          }
        }

      } catch (error) {
        logger.error('OpenAI Assistant API Error:', error);
        return res.status(500).json({
          error: 'Erreur lors de la génération de la réponse. Veuillez réessayer.'
        });
      }
    }

    // Calculer le temps de réponse
    const responseTimeMs = Date.now() - startTime;

    // ====================================
    // SAUVEGARDER LES MESSAGES DE LA CONVERSATION
    // ====================================
    try {
      if (conversationSessionId) {
        // Sauvegarder la question de l'utilisateur
        await addConversationMessage(conversationSessionId, 'user', message, {
          tokensUsed: 0,
          responseTimeMs: null,
          wasCached: false
        });

        // Sauvegarder la réponse complète de l'assistant (avec bloc INTERNAL si présent)
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
      // Ne pas bloquer la réponse si la sauvegarde échoue
      logger.error('Erreur sauvegarde conversation:', error);
    }

    // Définir le cookie d'identifiant anonyme si nécessaire
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

