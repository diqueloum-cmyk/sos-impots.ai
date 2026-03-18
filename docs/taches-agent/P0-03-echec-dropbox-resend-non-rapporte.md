# P0-03 — Signaler les échecs Dropbox et Resend dans le webhook Stripe

## Contexte

Dans `api/stripe-webhook.js`, si `DROPBOX_ACCESS_TOKEN` ou `RESEND_API_KEY` manquent (ou si les appels API échouent), le webhook retourne quand même 200 à Stripe sans rien signaler. Le client a payé mais ne reçoit ni lien Dropbox ni email de confirmation.

## Comportement actuel

```js
// Si token manquant → retourne null silencieusement
if (!token) {
  logger.warn('DROPBOX_ACCESS_TOKEN non configuré — File Request non créé');
  return null;
}
```

```js
// Si RESEND_API_KEY manquant → retourne silencieusement
if (!apiKey) {
  logger.warn('RESEND_API_KEY non configuré — email non envoyé');
  return;
}
```

## Comportement attendu

1. Logger une erreur `logger.error` (pas warn) si Dropbox ou Resend échouent — pour que ce soit visible dans les logs Vercel
2. Dans la notification interne, indiquer clairement si le File Request Dropbox n'a pas pu être créé (champ "Lien Dropbox : ÉCHEC — vérifier les logs")
3. En cas d'échec total (pas d'email envoyé), envisager un retry ou une alerte

## Étapes

### 1. Dropbox
Dans `createDropboxFileRequest()` :
- Passer `logger.warn` → `logger.error` si token manquant
- Passer `logger.error` → déjà présent si appel API échoue ✅

### 2. Resend
Dans `sendEmail()` :
- Passer `logger.warn` → `logger.error` si apiKey manquant

### 3. Notification interne enrichie
Si `dropbox === null`, afficher dans l'email interne :
```
Lien Dropbox : ⚠️ ÉCHEC — File Request non créé (vérifier DROPBOX_ACCESS_TOKEN et les logs Vercel)
```

## Critères de validation

- [ ] Si `DROPBOX_ACCESS_TOKEN` manque, un `logger.error` est émis (visible dans Vercel logs)
- [ ] Si `RESEND_API_KEY` manque, un `logger.error` est émis
- [ ] La notification interne indique clairement si Dropbox a échoué
- [ ] Le webhook Stripe retourne toujours 200 (pour éviter les retries Stripe) mais les échecs sont loggés
