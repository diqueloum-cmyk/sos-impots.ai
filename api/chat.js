import { parseCookies, setCorsHeaders, handleCorsPreflight, createCookie } from '../lib/utils.js';
import {
  getCachedAnswer,
  saveCachedAnswer,
  findUserByEmail,
  createConversationSession,
  addConversationMessage
} from '../lib/db.js';
import {
  chatRateLimiter,
  chatRateLimiterRegistered,
  getClientIp,
  checkRateLimit,
  sendRateLimitError,
  addRateLimitHeaders
} from '../lib/ratelimit.js';
import logger from '../lib/logger.js';

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
    const { message, sessionId } = req.body;

    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Lire les cookies
    const cookies = parseCookies(req.headers.cookie || '');
    const qUsed = parseInt(cookies.q_used || '0');
    const registered = cookies.registered === '1';
    const userEmail = cookies.user_email;

    logger.debug('Cookies:', { qUsed, registered });

    // Récupérer l'utilisateur si connecté
    let currentUser = null;
    if (registered && userEmail) {
      try {
        currentUser = await findUserByEmail(userEmail);
      } catch (error) {
        logger.error('Erreur récupération utilisateur:', error);
      }
    }

    // ====================================
    // RATE LIMITING
    // ====================================
    const clientIp = getClientIp(req);

    // Choisir le rate limiter approprié
    const limiter = registered ? chatRateLimiterRegistered : chatRateLimiter;
    const identifier = registered && userEmail ? userEmail : clientIp;

    const rateLimit = await checkRateLimit(limiter, identifier);

    if (!rateLimit.success) {
      logger.security(`Rate limit dépassé pour ${identifier} (registered: ${registered})`);
      return sendRateLimitError(res, rateLimit);
    }

    // Ajouter les headers de rate limit à la réponse
    addRateLimitHeaders(res, rateLimit);

    // Vérifier si l'utilisateur a dépassé la limite
    if (!registered && qUsed >= 2) {
      return res.status(200).json({
        success: false,
        needSignup: true,
        message: 'Vous avez utilisé vos 2 questions gratuites. Inscrivez-vous pour continuer.',
        qUsed,
        remaining: 0
      });
    }

    // Vérifier que la clé API et l'Assistant ID sont présents
    if (!process.env.OPENAI_API_KEY) {
      logger.error('OPENAI_API_KEY not found in environment variables');
      return res.status(500).json({
        error: 'Configuration manquante. Veuillez contacter l\'administrateur.'
      });
    }

    const ASSISTANT_ID = process.env.ASSISTANT_ID || 'asst_Roo0D8nWTgXAaP7TPUjE63yo';

    // Mesurer le temps de réponse
    const startTime = Date.now();

    // Vérifier le cache d'abord
    const cachedResponse = await getCachedAnswer(message);
    let answer;
    let fromCache = false;
    let tokensUsed = 0;

    if (cachedResponse) {
      // Réponse trouvée dans le cache
      answer = cachedResponse.answer;
      fromCache = true;
      logger.info('Réponse servie depuis le cache (hit count:', cachedResponse.hitCount, ')');
    } else {
      // Pas de cache, utiliser l'Assistant OpenAI
      try {
        // Étape 1: Créer un thread
        const threadResponse = await fetch('https://api.openai.com/v1/threads', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'assistants=v2'
          },
          body: JSON.stringify({})
        });

        if (!threadResponse.ok) {
          logger.error('OpenAI Thread Creation Error:', threadResponse.status);
          throw new Error('Erreur lors de la création du thread');
        }

        const threadData = await threadResponse.json();
        const threadId = threadData.id;

        // Préfixer le message avec le rappel du format obligatoire
        const formatReminder = `RAPPEL FORMAT OBLIGATOIRE : Tu DOIS suivre cette structure EXACTE pour ta réponse :
## 1. Contexte / Question de l'utilisateur
## 2. Hypothèses formulées si des informations manquent
## 3. Analyse fiscale (articles du Code général des impôts, sources officielles)
## 4. Options possibles
## 5. Recommandation
## 6. Points de vigilance fiscaux
## 7. Prochaines étapes / Questions complémentaires

Question de l'utilisateur :
${message}`;

        // Étape 2: Ajouter le message au thread
        const messageResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'assistants=v2'
          },
          body: JSON.stringify({
            role: 'user',
            content: formatReminder
          })
        });

        if (!messageResponse.ok) {
          logger.error('OpenAI Message Error:', messageResponse.status);
          throw new Error('Erreur lors de l\'ajout du message');
        }

        // Étape 3: Exécuter l'assistant
        const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'assistants=v2'
          },
          body: JSON.stringify({
            assistant_id: ASSISTANT_ID,
            temperature: 0,
            additional_instructions: "IMPORTANT : Respecte STRICTEMENT le format structuré en 7 sections pour CHAQUE réponse fiscale. Cite toujours les articles du CGI pertinents dans la section 3. Ne dévie JAMAIS de cette structure."
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

        answer = assistantMessage.content[0].text.value;

        // Estimer les tokens (approximation basée sur la longueur)
        tokensUsed = Math.ceil((message.length + answer.length) / 4);

        // Sauvegarder la réponse dans le cache
        await saveCachedAnswer(message, answer);

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
    // SAUVEGARDER LA CONVERSATION (si utilisateur connecté)
    // ====================================
    let conversationSessionId = sessionId;

    if (currentUser) {
      try {
        // Si pas de sessionId, créer une nouvelle session
        if (!conversationSessionId) {
          conversationSessionId = await createConversationSession(currentUser.id, message);
          logger.debug('Nouvelle session créée:', conversationSessionId);
        }

        // Sauvegarder la question de l'utilisateur
        await addConversationMessage(conversationSessionId, 'user', message, {
          tokensUsed: 0,
          responseTimeMs: null,
          wasCached: false
        });

        // Sauvegarder la réponse de l'assistant
        await addConversationMessage(conversationSessionId, 'assistant', answer, {
          tokensUsed,
          responseTimeMs,
          wasCached: fromCache
        });

        logger.info('Conversation sauvegardée:', {
          userId: currentUser.id,
          sessionId: conversationSessionId,
          cached: fromCache
        });

      } catch (error) {
        // Ne pas bloquer la réponse si la sauvegarde échoue
        logger.error('Erreur sauvegarde conversation:', error);
      }
    }

    // Incrémenter le compteur de questions si non inscrit
    const newQUsed = registered ? qUsed : qUsed + 1;
    const remaining = registered ? 'illimité' : Math.max(0, 2 - newQUsed);

    // Définir les cookies
    if (!registered) {
      const cookie = createCookie('q_used', newQUsed.toString(), {
        maxAge: 24 * 60 * 60 // 24 heures
      });
      res.setHeader('Set-Cookie', cookie);
    }

    return res.status(200).json({
      success: true,
      response: answer,
      qUsed: newQUsed,
      remaining,
      cached: fromCache,
      sessionId: conversationSessionId // Retourner le sessionId pour le frontend
    });

  } catch (error) {
    logger.error('Chat API Error:', error);
    return res.status(500).json({
      error: 'Erreur interne du serveur'
    });
  }
}

