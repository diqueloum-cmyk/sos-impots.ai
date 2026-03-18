# P0-02 — Déplacer ASSISTANT_ID en variable d'environnement Vercel

## Contexte

Dans `api/chat.js` ligne 90, l'ID de l'assistant OpenAI est hardcodé en fallback :

```js
const ASSISTANT_ID = process.env.ASSISTANT_ID || 'asst_dwzcjEy7UaGPLek26oQ7mlZG';
```

Si le dépôt est public sur GitHub, cet ID est exposé. N'importe qui peut appeler cet assistant directement, épuiser le crédit API ou analyser le comportement du système.

## Fichiers concernés

- `api/chat.js` ligne 90

## Correction

Supprimer le fallback hardcodé et lever une erreur si la variable manque :

```js
const ASSISTANT_ID = process.env.ASSISTANT_ID;
if (!ASSISTANT_ID) {
  logger.error('ASSISTANT_ID non configuré');
  return res.status(500).json({ error: 'Configuration manquante.' });
}
```

## Variable à ajouter dans Vercel

```
ASSISTANT_ID = asst_dwzcjEy7UaGPLek26oQ7mlZG
```

## Critères de validation

- [ ] Plus aucun ID hardcodé dans le code source
- [ ] Si `ASSISTANT_ID` manque, le serveur retourne une erreur 500 explicite
- [ ] La variable est configurée dans Vercel (prod + preview)
