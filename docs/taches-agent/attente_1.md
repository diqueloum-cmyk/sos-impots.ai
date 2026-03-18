# P3-01 — Intégrer paiement et upload de documents

## Contexte

Le nouvel agent promet trois offres payantes et un espace sécurisé pour les documents :

| Offre | Prix | Délai |
|-------|------|-------|
| Analyse Express IA | 39 € | 24h ouvrées |
| Analyse Premium IA + fiscaliste | 99 € | 48h ouvrées |
| Mise en relation avocat | Gratuit | 24h ouvrées |

L'agent promet aussi un "coffre-fort" sécurisé pour l'upload de documents (proposition de rectification, déclarations de revenus, justificatifs).

Actuellement, **aucune de ces fonctionnalités n'existe** dans le code. C'est le développement le plus conséquent.

## Fonctionnalités à développer

### 1. Système de paiement

**Solution recommandée : Stripe Checkout**

Stripe est le choix naturel pour Vercel (intégration native, serverless-friendly).

Parcours utilisateur :
```
Utilisateur choisit "Express 39€" dans le chat
  → Backend crée une session Stripe Checkout
  → Utilisateur est redirigé vers Stripe
  → Paiement effectué
  → Webhook Stripe → Backend met à jour le statut du dossier
  → Utilisateur redirigé vers page de confirmation
```

Fichiers à créer :
- `api/create-checkout.js` — Crée une session Stripe Checkout avec l'offre choisie
- `api/stripe-webhook.js` — Reçoit les événements Stripe (payment_intent.succeeded)
- `api/payment-status.js` — Vérifie le statut d'un paiement

Variables d'environnement à ajouter :
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_EXPRESS` — ID du prix Stripe pour l'offre Express (39€)
- `STRIPE_PRICE_PREMIUM` — ID du prix Stripe pour l'offre Premium (99€)

Dépendance npm à ajouter :
- `stripe` (SDK Stripe)

Table en base :
```sql
CREATE TABLE orders (
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
);
```

### 2. Espace sécurisé / upload de documents

**Solution recommandée : Vercel Blob + lien sécurisé**

Vercel Blob permet de stocker des fichiers directement depuis les serverless functions, avec des URLs signées à durée limitée.

Parcours utilisateur :
```
Après paiement, l'utilisateur reçoit un email avec un lien vers son espace
  → Page sécurisée avec mot de passe (qu'il définit)
  → Upload de fichiers (drag & drop)
  → Fichiers stockés dans Vercel Blob
  → Notification admin quand documents reçus
```

Fichiers à créer :
- `public/espace-client.html` — Page d'upload sécurisée
- `api/upload-document.js` — Réception et stockage des fichiers
- `api/client-space.js` — Vérification d'accès à l'espace client
- `api/send-confirmation.js` — Envoi d'email de confirmation avec lien

Variables d'environnement :
- `BLOB_READ_WRITE_TOKEN` (Vercel Blob)
- `RESEND_API_KEY` ou `SENDGRID_API_KEY` (pour l'envoi d'emails)

Dépendances npm :
- `@vercel/blob`
- `resend` ou `@sendgrid/mail`

Tables en base :
```sql
CREATE TABLE client_spaces (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  access_token TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  client_space_id INTEGER REFERENCES client_spaces(id),
  filename TEXT NOT NULL,
  blob_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  uploaded_at TIMESTAMP DEFAULT NOW()
);
```

### 3. Intégration dans le chat

Quand l'utilisateur choisit une offre dans le chat, le backend doit :

1. Détecter le choix d'offre dans le bloc `---INTERNAL---` (champ `offre_choisie`)
2. Si `offre_choisie` est `express_39` ou `premium_99` → créer une session Stripe et renvoyer l'URL de paiement au frontend
3. Si `offre_choisie` est `avocat_gratuit` → créer le dossier directement et envoyer l'email de confirmation

Le frontend doit détecter l'URL Stripe dans la réponse et proposer un bouton de paiement.

## Solution temporaire (avant le développement complet)

En attendant l'intégration Stripe + upload, adapter le message de confirmation pour rediriger vers un process manuel :

```
"Pour finaliser votre commande, envoyez-nous vos documents par email à
dossiers@sos-impots.ai en mentionnant votre numéro de dossier [ID].
Vous recevrez un lien de paiement sécurisé par retour d'email."
```

Cela nécessite uniquement :
- Générer un numéro de dossier unique (déjà fait via `conversation_sessions.id`)
- Envoyer un email de notification à l'admin quand une offre est choisie

## Estimation d'effort

| Composant | Effort |
|-----------|--------|
| Intégration Stripe (checkout + webhook) | 2-3 jours |
| Espace client + upload documents | 3-4 jours |
| Envoi d'emails transactionnels | 1 jour |
| Intégration dans le flow du chat | 1-2 jours |
| Tests + déploiement | 1-2 jours |
| **Total** | **8-12 jours** |

## Critères de validation

- [x] L'utilisateur peut payer 39€ ou 99€ via Stripe Checkout (liens statiques)
- [x] Le webhook Stripe met à jour le statut du dossier en base
- [ ] L'utilisateur reçoit un email de confirmation après paiement
- [ ] L'espace client sécurisé permet l'upload de documents
- [ ] Les documents sont stockés de manière chiffrée
- [ ] L'admin est notifié quand des documents sont reçus
- [ ] L'offre "Avocat gratuit" crée le dossier sans paiement
- [ ] Le flow complet fonctionne : chat → choix offre → paiement → upload → livraison
