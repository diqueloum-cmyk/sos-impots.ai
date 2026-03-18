# P1-01 — Supprimer ou rediriger la page deposer-documents.html

## Contexte

La page `public/deposer-documents.html` et l'endpoint `api/upload-document.js` uploadent des fichiers vers **Vercel Blob**. Depuis la migration vers Dropbox, cette page est obsolète : le client reçoit désormais un lien File Request Dropbox par email après paiement.

La page reste accessible via `/deposer-documents` (mappée dans `vercel.json`) et peut créer de la confusion si un client y accède.

## Fichiers concernés

- `public/deposer-documents.html` — page d'upload Vercel Blob
- `api/upload-document.js` — endpoint Vercel Blob
- `vercel.json` — rewrite vers deposer-documents

## Options

### Option A — Supprimer (recommandé)
Supprimer `deposer-documents.html` et `upload-document.js`, retirer le rewrite de `vercel.json`.

### Option B — Rediriger
Remplacer le contenu de `deposer-documents.html` par une redirection ou un message :
> "Pour déposer vos documents, utilisez le lien Dropbox reçu par email suite à votre paiement."

## Étapes (Option A)

1. Supprimer `public/deposer-documents.html`
2. Supprimer `api/upload-document.js`
3. Dans `vercel.json`, supprimer le rewrite `{ "source": "/deposer-documents", ... }`
4. Vérifier qu'aucun autre fichier ne référence `/deposer-documents` ou `/api/upload-document`

## Points de vigilance

- Vérifier dans `public/index.html` s'il y a des liens vers `/deposer-documents`
- Vérifier dans `api/stripe-webhook.js` (ancienne version référençait `UPLOAD_BASE_URL`) — déjà supprimé ✅

## Critères de validation

- [ ] La page `/deposer-documents` retourne 404 ou une page de redirection
- [ ] Aucun lien mort dans l'interface
- [ ] `vercel.json` ne mappe plus `/deposer-documents`
