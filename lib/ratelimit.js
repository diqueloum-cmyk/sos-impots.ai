// Rate limiting avec Upstash Redis
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Vérifier si Upstash est configuré
const isUpstashConfigured = () => {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
};

// Initialiser Redis seulement si configuré
let redis = null;
if (isUpstashConfigured()) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

/**
 * Rate limiter pour l'API Chat (OpenAI)
 * 10 requêtes par heure par IP
 */
export const chatRateLimiter = redis ? new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 h'),
  analytics: true,
  prefix: 'ratelimit:chat',
}) : null;

/**
 * Rate limiter pour les endpoints admin
 * 30 requêtes par heure
 */
export const adminRateLimiter = redis ? new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 h'),
  analytics: true,
  prefix: 'ratelimit:admin',
}) : null;

/**
 * Récupérer l'IP du client
 * @param {Request} req - Requête Vercel
 * @returns {string} Adresse IP du client
 */
export function getClientIp(req) {
  // Vercel fournit l'IP dans les headers
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded
    ? forwarded.split(',')[0].trim()
    : req.headers['x-real-ip'] || req.connection?.remoteAddress || 'unknown';

  return ip;
}

/**
 * Vérifier le rate limit et retourner une réponse appropriée
 * @param {Ratelimit} rateLimiter - Instance du rate limiter
 * @param {string} identifier - Identifiant (IP, user ID, etc.)
 * @returns {Promise<{success: boolean, limit: number, remaining: number, reset: number}>}
 */
export async function checkRateLimit(rateLimiter, identifier) {
  // Si Upstash n'est pas configuré, autoriser (mode dev)
  if (!rateLimiter) {
    console.warn('⚠️ Rate limiting désactivé - Upstash non configuré');
    return {
      success: true,
      limit: 999999,
      remaining: 999999,
      reset: Date.now() + 3600000,
    };
  }

  try {
    const { success, limit, remaining, reset } = await rateLimiter.limit(identifier);

    return {
      success,
      limit,
      remaining,
      reset,
    };
  } catch (error) {
    console.error('Erreur rate limiting:', error);
    // En cas d'erreur, autoriser pour ne pas bloquer le service
    return {
      success: true,
      limit: 0,
      remaining: 0,
      reset: Date.now() + 3600000,
      error: true,
    };
  }
}

/**
 * Créer une réponse 429 Too Many Requests
 * @param {Response} res - Objet response
 * @param {Object} rateLimit - Infos du rate limit
 * @returns {Response} Réponse 429
 */
export function sendRateLimitError(res, rateLimit) {
  const retryAfter = Math.ceil((rateLimit.reset - Date.now()) / 1000);

  res.setHeader('X-RateLimit-Limit', rateLimit.limit.toString());
  res.setHeader('X-RateLimit-Remaining', rateLimit.remaining.toString());
  res.setHeader('X-RateLimit-Reset', rateLimit.reset.toString());
  res.setHeader('Retry-After', retryAfter.toString());

  return res.status(429).json({
    error: 'Trop de requêtes. Veuillez réessayer plus tard.',
    retryAfter: retryAfter,
    limit: rateLimit.limit,
    remaining: rateLimit.remaining,
    resetAt: new Date(rateLimit.reset).toISOString(),
  });
}

/**
 * Ajouter les headers de rate limit à une réponse réussie
 * @param {Response} res - Objet response
 * @param {Object} rateLimit - Infos du rate limit
 */
export function addRateLimitHeaders(res, rateLimit) {
  res.setHeader('X-RateLimit-Limit', rateLimit.limit.toString());
  res.setHeader('X-RateLimit-Remaining', rateLimit.remaining.toString());
  res.setHeader('X-RateLimit-Reset', rateLimit.reset.toString());
}
