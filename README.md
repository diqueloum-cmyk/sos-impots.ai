# sos-impots.ai - Site Web avec Chatbot IA

Site web professionnel pour conseil fiscal en fiscalité avec chatbot IA intégré et système d'inscription.

## ⚠️ Migration Vercel Postgres - IMPORTANT

**Le projet a été migré vers Vercel Postgres le [Date]**

- ✅ Base de données persistante (PostgreSQL)
- ✅ Authentification sécurisée (bcrypt)
- ✅ Fini les pertes de données !

**📖 Guides de configuration :**
- [🚀 Quick Start](docs/QUICK_START.md) - Démarrage rapide en 5 étapes (7 min)
- [📖 Guide Setup Postgres](docs/SETUP_POSTGRES.md) - Configuration complète de la base de données
- [📋 Résumé de Migration](docs/MIGRATION_SUMMARY.md) - Changements effectués et détails techniques
- [✅ Checklist de Déploiement](docs/DEPLOYMENT_CHECKLIST.md) - Checklist complète étape par étape

## 🚀 Fonctionnalités

- **Chatbot IA** spécialisé en droit fiscal et de la fiscalité (OpenAI GPT-3.5-turbo)
- **Système de limitation** : 2 questions gratuites par utilisateur
- **Inscription gratuite** pour questions illimitées
- **Interface responsive** avec Tailwind CSS
- **SEO optimisé** pour le référencement Google
- **Backend serverless** avec Vercel
- **Clé API sécurisée** côté serveur

## 📁 Structure du projet

```
sos-impots-site/
├── index.html                  # Page principale
├── admin.html                  # Dashboard administrateur
├── logo-sosimpots.png         # Logo du site
├── api/
│   ├── chat.js                # API chatbot avec OpenAI
│   ├── signup.js              # API inscription utilisateur
│   ├── setup-db.js            # Initialisation de la base de données
│   ├── test-db.js             # Test de connexion à la DB
│   ├── auth.js                # Utilitaires d'authentification
│   ├── users.js               # Gestion des utilisateurs
│   ├── googlesheets.js        # Intégration Google Sheets
│   ├── airtable.js            # Intégration Airtable
│   └── health.js              # Health check
├── lib/
│   ├── db.js                  # ✅ NOUVEAU: Base de données Postgres
│   └── database.js.backup     # 📦 Ancien système (sauvegarde)
├── vercel.json                # Configuration Vercel
├── package.json               # Dépendances Node.js
├── README.md                  # Documentation principale
└── docs/                      # 📚 Documentation complète
    ├── QUICK_START.md         # 🚀 Guide rapide (5 étapes)
    ├── SETUP_POSTGRES.md      # 📖 Configuration Postgres
    ├── MIGRATION_SUMMARY.md   # 📋 Résumé technique
    └── DEPLOYMENT_CHECKLIST.md # ✅ Checklist déploiement
```

## 🛠️ Déploiement sur Vercel

### 1. Prérequis
- Compte [Vercel](https://vercel.com)
- Clé API OpenAI (obtenir sur [OpenAI Platform](https://platform.openai.com))

### 2. Installation
```bash
# Installer Vercel CLI
npm install -g vercel

# Dans le dossier du projet
npm install
```

### 3. Configuration des variables d'environnement
```bash
# Ajouter la clé OpenAI à Vercel
vercel env add OPENAI_API_KEY
# Coller votre clé API OpenAI quand demandé
```

### 4. Déploiement
```bash
# Déploiement de test
vercel

# Déploiement en production
vercel --prod
```

## 🔧 Configuration locale

Pour tester en local :

```bash
# Lancer le serveur de développement
vercel dev

# Le site sera accessible sur http://localhost:3000
```

## 📋 Variables d'environnement requises

### Obligatoires
- `OPENAI_API_KEY` : Clé API OpenAI pour le chatbot
- `SETUP_KEY` : Clé secrète pour `/api/setup-db`

### Automatiques (ajoutées par Vercel lors de la connexion Postgres)
- `POSTGRES_URL` : URL de connexion PostgreSQL
- `POSTGRES_USER` : Utilisateur PostgreSQL
- `POSTGRES_HOST` : Hôte PostgreSQL
- `POSTGRES_PASSWORD` : Mot de passe PostgreSQL
- `POSTGRES_DATABASE` : Nom de la base de données

### Optionnelles
- `GOOGLE_WEBHOOK_URL` : Webhook pour Google Sheets (Make.com/Zapier)
- `GOOGLE_SCRIPT_URL` : Google Apps Script URL
- `AIRTABLE_API_KEY` : Clé API Airtable
- `AIRTABLE_BASE_ID` : ID de la base Airtable

## 🎯 Fonctionnement du système

### Limitation des questions
- **Utilisateurs non inscrits** : 2 questions gratuites
- **Utilisateurs inscrits** : Questions illimitées
- Gestion via cookies (24h pour non-inscrits, 1 an pour inscrits)

### API Endpoints
- `POST /api/chat` : Traitement des questions chatbot
- `POST /api/signup` : Inscription des utilisateurs
- `GET /api/setup-db?key=XXX` : Initialisation de la base de données (1 seule fois)
- `GET /api/test-db` : Test de connexion à la base de données
- `GET /api/health` : Health check de l'API

### Cookies utilisés
- `q_used` : Nombre de questions utilisées
- `registered` : Statut d'inscription (0/1)
- `user_name` : Prénom de l'utilisateur inscrit

## 🎨 Personnalisation

Le site utilise Tailwind CSS pour le styling. Vous pouvez :
- Modifier les couleurs dans `index.html`
- Ajuster les prompts IA dans `api/chat.js`
- Personnaliser le modal d'inscription

## 📱 Responsive Design

Le site est entièrement responsive :
- **Mobile** : Navigation simplifiée, modal adapté
- **Desktop** : Layout en colonnes, navigation complète
- **Tablette** : Adaptation automatique

## 🔒 Sécurité

- Clé API OpenAI côté serveur uniquement
- Validation des données d'inscription
- Protection CORS configurée
- Cookies sécurisés avec SameSite

## 📈 SEO

Le site est optimisé pour le référencement :
- Balises meta complètes
- Structure H1/H2/H3 optimisée
- Schema.org pour les moteurs de recherche
- Open Graph et Twitter Cards

## 🐛 Dépannage

### Erreur "API Key not found"
Vérifiez que `OPENAI_API_KEY` est bien configuré dans Vercel.

### Modal ne s'affiche pas
Vérifiez que Tailwind CSS se charge correctement.

### Cookies non persistants
Vérifiez la configuration HTTPS en production.

## 📞 Support

Pour toute question technique, consultez la documentation Vercel ou OpenAI.

