// ====================================
// GESTION DES COOKIES - SOS-Impots.ai
// ====================================

// Vérifier et afficher le bandeau cookies au chargement
function checkCookieConsent() {
  const consent = localStorage.getItem('cookieConsent');
  if (!consent) {
    createCookieBanner();
  } else {
    const preferences = JSON.parse(consent);
    loadCookies(preferences);
  }
}

// Créer le bandeau cookies dynamiquement
function createCookieBanner() {
  const banner = document.createElement('div');
  banner.id = 'cookieBannerDynamic';
  banner.style.cssText = 'position: fixed; bottom: 0; left: 0; right: 0; width: 100%; background-color: white; box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15); border-top: 3px solid #2563eb; z-index: 99999; padding: 1.5rem;';

  banner.innerHTML = `
    <div style="max-width: 72rem; margin: 0 auto;">
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div style="flex: 1;">
          <h3 style="font-weight: bold; font-size: 1.125rem; color: #111827; margin-bottom: 0.5rem;">🍪 Gestion des cookies</h3>
          <p style="font-size: 0.875rem; color: #4B5563;">
            Nous utilisons des cookies pour améliorer votre expérience sur notre site. Aucun cookie non essentiel (Google Analytics, Google Ads, Meta, etc.) ne sera activé avant votre consentement.
          </p>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
          <button onclick="acceptAllCookies()" style="background-color: #2563eb; color: white; padding: 0.5rem 1rem; border-radius: 0.5rem; border: none; cursor: pointer; font-size: 0.875rem; font-weight: 500;">
            Accepter tous les cookies
          </button>
          <button onclick="acceptEssentialOnly()" style="background-color: #E5E7EB; color: #1F2937; padding: 0.5rem 1rem; border-radius: 0.5rem; border: none; cursor: pointer; font-size: 0.875rem; font-weight: 500;">
            Refuser tous (sauf nécessaires)
          </button>
          <button onclick="showCookiePreferences()" style="background-color: white; color: #1F2937; padding: 0.5rem 1rem; border-radius: 0.5rem; border: 1px solid #D1D5DB; cursor: pointer; font-size: 0.875rem; font-weight: 500;">
            Personnaliser
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(banner);
}

// Accepter tous les cookies
function acceptAllCookies() {
  const preferences = {
    necessary: true,
    statistics: true,
    advertising: true
  };
  saveCookieConsent(preferences);
  hideCookieBanner();
  loadCookies(preferences);
}

// Accepter uniquement les cookies nécessaires
function acceptEssentialOnly() {
  const preferences = {
    necessary: true,
    statistics: false,
    advertising: false
  };
  saveCookieConsent(preferences);
  hideCookieBanner();
  loadCookies(preferences);
}

// Afficher le modal de personnalisation
function showCookiePreferences() {
  // Créer le modal s'il n'existe pas déjà
  if (!document.getElementById('cookiePreferencesModal')) {
    createCookieModal();
  }

  // Masquer temporairement le bandeau
  const banner = document.getElementById('cookieBannerDynamic');
  if (banner) {
    banner.style.display = 'none';
  }

  document.getElementById('cookiePreferencesModal').classList.remove('hidden');
  // Charger les préférences existantes si elles existent
  const consent = localStorage.getItem('cookieConsent');
  if (consent) {
    const preferences = JSON.parse(consent);
    document.getElementById('cookieStats').checked = preferences.statistics || false;
    document.getElementById('cookieAds').checked = preferences.advertising || false;
  }
}

// Créer le modal de personnalisation dynamiquement
function createCookieModal() {
  const modal = document.createElement('div');
  modal.id = 'cookiePreferencesModal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 hidden z-[10000] overflow-y-auto';

  modal.innerHTML = `
    <div class="flex justify-center min-h-screen p-4 py-8">
      <div class="bg-white rounded-lg max-w-2xl w-full my-auto" style="max-height: calc(100vh - 4rem);">
        <div class="p-6 overflow-y-auto" style="max-height: calc(100vh - 8rem);">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-2xl font-bold text-gray-900">Préférences des cookies</h2>
            <button onclick="closeCookiePreferences()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
          </div>

          <p class="text-sm text-gray-600 mb-6">
            Vous pouvez choisir quels types de cookies vous souhaitez autoriser. Les cookies nécessaires sont toujours activés car ils sont indispensables au fonctionnement du site.
          </p>

          <div class="space-y-4">
            <!-- Cookies nécessaires -->
            <div class="border border-gray-200 rounded-lg p-4">
              <div class="flex items-center justify-between mb-2">
                <h3 class="font-bold text-gray-900">Cookies nécessaires</h3>
                <span class="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">Toujours actifs</span>
              </div>
              <p class="text-sm text-gray-600">
                Ces cookies sont essentiels au fonctionnement du site (authentification, sécurité, préférences).
              </p>
            </div>

            <!-- Cookies statistiques -->
            <div class="border border-gray-200 rounded-lg p-4">
              <div class="flex items-center justify-between mb-2">
                <h3 class="font-bold text-gray-900">Cookies statistiques</h3>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" id="cookieStats" class="sr-only peer">
                  <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
              <p class="text-sm text-gray-600">
                Google Analytics pour comprendre comment les visiteurs utilisent le site (anonymisé).
              </p>
            </div>

            <!-- Cookies publicitaires -->
            <div class="border border-gray-200 rounded-lg p-4">
              <div class="flex items-center justify-between mb-2">
                <h3 class="font-bold text-gray-900">Cookies publicitaires</h3>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" id="cookieAds" class="sr-only peer">
                  <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
              <p class="text-sm text-gray-600">
                Google Ads, Meta Pixel pour afficher des publicités personnalisées.
              </p>
            </div>
          </div>

          <div class="flex gap-2 mt-6">
            <button onclick="saveCustomPreferences()" class="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium">
              Enregistrer mes préférences
            </button>
            <button onclick="closeCookiePreferences()" class="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300 transition-colors font-medium">
              Annuler
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

// Fermer le modal de personnalisation
function closeCookiePreferences() {
  document.getElementById('cookiePreferencesModal').classList.add('hidden');
  // Réafficher le bandeau si le consentement n'a pas été donné
  const consent = localStorage.getItem('cookieConsent');
  if (!consent) {
    const banner = document.getElementById('cookieBannerDynamic');
    if (banner) {
      banner.style.display = 'block';
    }
  }
}

// Enregistrer les préférences personnalisées
function saveCustomPreferences() {
  const preferences = {
    necessary: true,
    statistics: document.getElementById('cookieStats').checked,
    advertising: document.getElementById('cookieAds').checked
  };
  saveCookieConsent(preferences);
  closeCookiePreferences();
  hideCookieBanner();
  loadCookies(preferences);
}

// Sauvegarder le consentement
function saveCookieConsent(preferences) {
  localStorage.setItem('cookieConsent', JSON.stringify(preferences));
  localStorage.setItem('cookieConsentDate', new Date().toISOString());
}

// Masquer le bandeau
function hideCookieBanner() {
  const banner = document.getElementById('cookieBannerDynamic');
  if (banner) {
    banner.remove();
  }
}

// Charger les cookies selon les préférences
function loadCookies(preferences) {
  if (preferences.statistics) {
    // Charger Google Analytics ici si besoin
  }
  if (preferences.advertising) {
    // Charger Google Ads et Meta Pixel ici si besoin
  }
}

// Initialiser au chargement de la page
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkCookieConsent);
} else {
  checkCookieConsent();
}
