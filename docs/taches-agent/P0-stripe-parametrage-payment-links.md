# Paramétrage Stripe — Payment Links & Webhook

**Priorité :** P0
**Statut :** À faire
**Contexte :** Le webhook Stripe a été corrigé côté code (commit `d7384b1`). Il reste le paramétrage côté Dashboard Stripe.

---

## 1. Ajouter les métadonnées `offer_type` sur chaque Payment Link

**Où :** Dashboard Stripe > Payment Links

### Lien Express 39€ (`buy.stripe.com/3cIbJ09wqa4i5tMff0ejK00`)
- Paramètres du lien > section **Metadata**
- Ajouter : clé = `offer_type`, valeur = `express_39`

### Lien Premium 99€ (`buy.stripe.com/bJe28qfUOa4i2hAff0ejK01`)
- Paramètres du lien > section **Metadata**
- Ajouter : clé = `offer_type`, valeur = `premium_99`

> Sans ça, le code déduit l'offre depuis le montant (`>= 9900 → premium`), ce qui fonctionne mais casse si un prix change.

---

## 2. Vérifier la collecte d'informations client

**Où :** Paramètres de chaque Payment Link

- [ ] **"Collect email address"** activé — **OBLIGATOIRE** (sans email : pas d'email de confirmation, pas de lien Dropbox)
- [ ] **"Collect name"** activé — recommandé (utilisé pour nommer le dossier Dropbox : `Dossier_Jean_Dupont_20260322`)

---

## 3. Vérifier le webhook

**Où :** Dashboard Stripe > Developers > Webhooks

- [ ] URL du webhook = `https://sos-impots.ai/api/stripe-webhook`
- [ ] Event `checkout.session.completed` coché
- [ ] Event `checkout.session.expired` coché (marquer les paiements échoués)
- [ ] Event `charge.refunded` coché (tracer les remboursements)
- [ ] Le **Signing secret** correspond à la variable `STRIPE_WEBHOOK_SECRET` sur Vercel (Settings > Environment Variables)

---

## 4. Tester le flow complet

1. Activer le **mode test** dans Stripe Dashboard > Developers
2. Ouvrir le site, poser une question à l'IA qui déclenche une offre
3. Cliquer sur le bouton de paiement
4. **Vérifier dans l'URL** que `?client_reference_id=XX` est bien présent (lien conversation ↔ paiement)
5. Payer avec la carte de test `4242 4242 4242 4242` (date future, CVC quelconque)
6. Vérifier dans les **logs Vercel** (Deployments > Functions) que :
   - `Commande créée` apparaît (INSERT OK)
   - `Email envoyé à` apparaît
   - Pas d'erreur Dropbox
7. Vérifier que l'email de confirmation arrive bien avec le lien Dropbox
8. Vérifier que la notification interne arrive à `contact@sos-impots.ai`

---

## Checklist résumé

| Action | Obligatoire | Fait |
|--------|:-----------:|:----:|
| Metadata `offer_type` sur lien 39€ | Recommandé | [ ] |
| Metadata `offer_type` sur lien 99€ | Recommandé | [ ] |
| Collect email activé | **Oui** | [ ] |
| Collect name activé | Recommandé | [ ] |
| Webhook URL correcte | **Oui** | [ ] |
| Events webhook cochés | **Oui** | [ ] |
| `STRIPE_WEBHOOK_SECRET` dans Vercel | **Oui** | [ ] |
| Test flow complet en mode test | Recommandé | [ ] |
