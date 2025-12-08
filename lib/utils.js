// Fonctions utilitaires partagées
// Centralisation du code commun pour éviter les duplications

/**
 * Parser les cookies d'une requête HTTP
 * @param {string} cookieHeader - Header 'cookie' de la requête
 * @returns {Object} Objet avec les cookies parsés {name: value}
 *
 * @example
 * const cookies = parseCookies(req.headers.cookie);
 * console.log(cookies.registered); // "1"
 * console.log(cookies.user_email); // "user@example.com"
 */
export function parseCookies(cookieHeader) {
  const cookies = {};

  if (!cookieHeader) {
    return cookies;
  }

  cookieHeader.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  });

  return cookies;
}

/**
 * Liste blanche des origines autorisées pour CORS
 * ✅ SÉCURITÉ : Seuls ces domaines peuvent appeler l'API
 */
const ALLOWED_ORIGINS = [
  'https://sos-impots.ai',
  'https://www.sos-impots.ai',
  'http://localhost:3000',
  'http://localhost:5000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000',
  // Ajouter d'autres domaines au besoin
];

/**
 * Définir les headers CORS pour une réponse API avec liste blanche
 *
 * ✅ SÉCURITÉ : Vérifie que l'origine est dans la liste blanche
 * Refuse les requêtes provenant de domaines non autorisés
 *
 * @param {Response} res - Objet response de Vercel
 * @param {Request} req - Objet request de Vercel (pour vérifier l'origin)
 * @param {Object} options - Options de configuration CORS
 * @param {string} options.methods - Méthodes HTTP autorisées
 * @param {string} options.headers - Headers autorisés
 *
 * @example
 * setCorsHeaders(res, req);
 * // ou avec options personnalisées
 * setCorsHeaders(res, req, { methods: 'GET, POST, PUT, DELETE' });
 */
export function setCorsHeaders(res, req = null, options = {}) {
  const {
    methods = 'GET, POST, OPTIONS',
    headers = 'Content-Type'
  } = options;

  // Récupérer l'origine de la requête
  const requestOrigin = req?.headers?.origin || req?.headers?.referer || '';

  // Vérifier si l'origine est dans la liste blanche
  let allowedOrigin = null;

  if (ALLOWED_ORIGINS.includes(requestOrigin)) {
    allowedOrigin = requestOrigin;
  } else {
    // En développement local sans origin header, autoriser
    // (cas des requêtes depuis le même domaine)
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev && !requestOrigin) {
      allowedOrigin = ALLOWED_ORIGINS[0]; // Utiliser le premier de la liste
    }
  }

  // Si aucune origine autorisée trouvée, ne pas définir le header
  // Cela bloquera la requête CORS
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);
}

/**
 * Vérifier si une origine est autorisée
 * @param {string} origin - Origin à vérifier
 * @returns {boolean} True si autorisée
 */
export function isOriginAllowed(origin) {
  return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Gérer les requêtes OPTIONS (preflight CORS)
 * Retourne true si la requête a été gérée, false sinon
 *
 * @param {Request} req - Objet request de Vercel
 * @param {Response} res - Objet response de Vercel
 * @returns {boolean} True si c'est une requête OPTIONS qui a été gérée
 *
 * @example
 * if (handleCorsPrelight(req, res)) {
 *   return; // Requête OPTIONS gérée, on sort
 * }
 * // Continuer avec la logique normale
 */
export function handleCorsPreflight(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

/**
 * Créer un cookie sécurisé avec les bonnes options
 *
 * @param {string} name - Nom du cookie
 * @param {string} value - Valeur du cookie
 * @param {Object} options - Options du cookie
 * @param {number} options.maxAge - Durée de vie en secondes (défaut: 1 an)
 * @param {boolean} options.httpOnly - Cookie accessible uniquement en HTTP (défaut: false)
 * @param {boolean} options.secure - Cookie uniquement en HTTPS (défaut: false)
 * @param {string} options.sameSite - Protection CSRF (défaut: 'Lax')
 * @param {string} options.path - Path du cookie (défaut: '/')
 * @returns {string} String du cookie au format Set-Cookie
 *
 * @example
 * const cookieString = createCookie('registered', '1');
 * res.setHeader('Set-Cookie', cookieString);
 *
 * // Avec options sécurisées
 * const secureCookie = createCookie('token', 'abc123', {
 *   httpOnly: true,
 *   secure: true,
 *   maxAge: 3600
 * });
 */
export function createCookie(name, value, options = {}) {
  const {
    maxAge = 365 * 24 * 60 * 60, // 1 an par défaut
    httpOnly = false,
    secure = false,
    sameSite = 'Lax',
    path = '/'
  } = options;

  let cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=${path}; SameSite=${sameSite}`;

  if (httpOnly) {
    cookie += '; HttpOnly';
  }

  if (secure) {
    cookie += '; Secure';
  }

  return cookie;
}

/**
 * Créer plusieurs cookies d'un coup
 *
 * @param {Array<Object>} cookies - Array d'objets {name, value, options}
 * @returns {Array<string>} Array de strings de cookies
 *
 * @example
 * const cookies = createMultipleCookies([
 *   { name: 'registered', value: '1' },
 *   { name: 'user_name', value: 'John' },
 *   { name: 'user_email', value: 'john@example.com' }
 * ]);
 * res.setHeader('Set-Cookie', cookies);
 */
export function createMultipleCookies(cookies) {
  return cookies.map(({ name, value, options }) =>
    createCookie(name, value, options)
  );
}

/**
 * Valider un format d'email
 *
 * @param {string} email - Email à valider
 * @returns {boolean} True si l'email est valide
 *
 * @example
 * if (!isValidEmail(email)) {
 *   return res.status(400).json({ error: 'Email invalide' });
 * }
 */
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Valider que tous les champs requis sont présents
 *
 * @param {Object} data - Objet contenant les données
 * @param {Array<string>} requiredFields - Array des champs requis
 * @returns {Object} { valid: boolean, missing: Array<string> }
 *
 * @example
 * const validation = validateRequiredFields(
 *   { firstName: 'John', email: 'john@example.com' },
 *   ['firstName', 'lastName', 'email']
 * );
 *
 * if (!validation.valid) {
 *   return res.status(400).json({
 *     error: `Champs manquants: ${validation.missing.join(', ')}`
 *   });
 * }
 */
export function validateRequiredFields(data, requiredFields) {
  const missing = requiredFields.filter(field => !data[field]);

  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Formater une date en français
 *
 * @param {Date|string} date - Date à formater
 * @param {Object} options - Options de formatage
 * @returns {string} Date formatée
 *
 * @example
 * formatDateFr(new Date()); // "17/10/2024 19:30"
 */
export function formatDateFr(date, options = {}) {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  const defaultOptions = {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...options
  };

  return dateObj.toLocaleString('fr-FR', defaultOptions);
}

/**
 * Créer une réponse d'erreur standardisée
 *
 * @param {Response} res - Objet response
 * @param {number} status - Code HTTP
 * @param {string} message - Message d'erreur
 * @param {Object} extra - Données supplémentaires
 * @returns {Response} Response JSON
 *
 * @example
 * return sendError(res, 400, 'Email invalide');
 * return sendError(res, 500, 'Erreur serveur', { details: error.message });
 */
export function sendError(res, status, message, extra = {}) {
  return res.status(status).json({
    error: message,
    success: false,
    ...extra
  });
}

/**
 * Créer une réponse de succès standardisée
 *
 * @param {Response} res - Objet response
 * @param {Object} data - Données de succès
 * @param {number} status - Code HTTP (défaut: 200)
 * @returns {Response} Response JSON
 *
 * @example
 * return sendSuccess(res, { user: {...} });
 * return sendSuccess(res, { message: 'Créé' }, 201);
 */
export function sendSuccess(res, data = {}, status = 200) {
  return res.status(status).json({
    success: true,
    ...data
  });
}

/**
 * Logger une information de manière structurée et sécurisée
 *
 * ⚠️ SÉCURITÉ : Masque automatiquement les données sensibles
 * Ne jamais logger : mots de passe, tokens, clés API, emails complets
 *
 * @param {string} type - Type de log (info, error, warning)
 * @param {string} message - Message à logger
 * @param {Object} data - Données supplémentaires (seront filtrées)
 *
 * @example
 * logInfo('info', 'Utilisateur créé', { email: 'user@example.com' });
 * // Loggé : { email: 'u***@example.com' }
 *
 * logInfo('error', 'Échec connexion DB', { error: err.message });
 */
export function logInfo(type, message, data = {}) {
  const timestamp = new Date().toISOString();

  // Filtrer les données sensibles avant de logger
  const sanitizedData = sanitizeSensitiveData(data);

  const logData = {
    timestamp,
    type,
    message,
    ...sanitizedData
  };

  console.log(JSON.stringify(logData));
}

/**
 * Masquer les données sensibles dans un objet
 * ⚠️ IMPORTANT : À utiliser avant tout logging
 *
 * @param {Object} data - Données à assainir
 * @returns {Object} Données avec valeurs sensibles masquées
 *
 * @example
 * const clean = sanitizeSensitiveData({
 *   email: 'john@example.com',
 *   password: 'secret123',
 *   apiKey: 'sk-abc123def456'
 * });
 * // Retourne: {
 * //   email: 'j***@example.com',
 *   password: '***MASKED***',
 *   apiKey: 'sk-***'
 * // }
 */
export function sanitizeSensitiveData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sensitiveKeys = [
    'password',
    'password_hash',
    'passwordHash',
    'token',
    'accessToken',
    'refreshToken',
    'api_key',
    'apiKey',
    'apikey',
    'secret',
    'secretKey',
    'privateKey',
    'authorization',
    'cookie',
    'session'
  ];

  const sanitized = {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();

    // Vérifier si la clé est sensible
    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      // Masquer complètement les données sensibles
      if (typeof value === 'string' && value.length > 0) {
        // Garder juste le préfixe pour les clés API (ex: sk-, pk-)
        const prefix = value.match(/^[a-z]{2}-/i)?.[0] || '';
        sanitized[key] = prefix + '***MASKED***';
      } else {
        sanitized[key] = '***MASKED***';
      }
    }
    // Masquer partiellement les emails
    else if (lowerKey.includes('email') && typeof value === 'string') {
      sanitized[key] = maskEmail(value);
    }
    // Masquer les IPs
    else if (lowerKey.includes('ip') && typeof value === 'string') {
      sanitized[key] = maskIP(value);
    }
    // Récursif pour objets imbriqués
    else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeSensitiveData(value);
    }
    // Valeurs normales
    else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Masquer partiellement un email
 * @param {string} email - Email à masquer
 * @returns {string} Email masqué
 *
 * @example
 * maskEmail('john.doe@example.com'); // 'j***@example.com'
 */
export function maskEmail(email) {
  if (!email || typeof email !== 'string') return email;

  const [local, domain] = email.split('@');
  if (!domain) return email;

  // Garder le premier caractère, masquer le reste avant @
  const maskedLocal = local.length > 1 ? local[0] + '***' : local;
  return `${maskedLocal}@${domain}`;
}

/**
 * Masquer une adresse IP
 * @param {string} ip - IP à masquer
 * @returns {string} IP masquée
 *
 * @example
 * maskIP('192.168.1.100'); // '192.168.***.***'
 */
export function maskIP(ip) {
  if (!ip || typeof ip !== 'string') return ip;

  const parts = ip.split('.');
  if (parts.length === 4) {
    // IPv4 : masquer les 2 derniers octets
    return `${parts[0]}.${parts[1]}.***. ***`;
  }

  // IPv6 ou autre : masquer la moitié
  const half = Math.floor(ip.length / 2);
  return ip.substring(0, half) + '***';
}

/**
 * Générer un ID unique simple (pour développement)
 * Pour production, utiliser UUID ou la séquence PostgreSQL
 *
 * @returns {string} ID unique
 *
 * @example
 * const id = generateSimpleId(); // "1697563800000-xyz123"
 */
export function generateSimpleId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
