# P1-02 — Bloc ---INTERNAL--- perdu si réponse mise en cache

## Contexte

Dans `api/chat.js`, quand une réponse de l'assistant contient un bloc `---INTERNAL---`, la fonction `parseAgentResponse()` sépare la partie visible du JSON interne. Mais lors de la mise en cache (ligne 303), seule la `visibleResponse` est sauvegardée — le bloc INTERNAL est perdu.

Si ce même message est posé une seconde fois et servi depuis le cache, `internalData` est null → aucun lien de paiement n'est généré, le tunnel de conversion est cassé.

## Comportement actuel

```js
// Ligne 303 — sauvegarde uniquement la réponse visible
if (isNewConversation && isSubstantialMessage) {
  await saveCachedAnswer(message, visibleResponse);  // ❌ perd le bloc INTERNAL
}

// Ligne 141-145 — réponse cachée : internalData reste null
if (cachedResponse) {
  answer = cachedResponse.answer;
  fromCache = true;
  // internalData = null → pas de paymentUrl
}
```

## Comportement attendu

Le cache ne doit **jamais** stocker ni servir des réponses de fin de tunnel (celles qui contiennent un bloc INTERNAL). Ces réponses sont contextuelles (email, offre, montant) et ne peuvent pas être réutilisées entre utilisateurs.

## Correction

Dans `api/chat.js`, conditionner la mise en cache sur l'absence de bloc INTERNAL :

```js
// Ne mettre en cache que si pas de données internes (pas une fin de tunnel)
if (isNewConversation && isSubstantialMessage && !internalData) {
  await saveCachedAnswer(message, visibleResponse);
}
```

## Critères de validation

- [ ] Une réponse contenant `---INTERNAL---` n'est jamais mise en cache
- [ ] Le lien de paiement est toujours généré correctement, même si la question a déjà été posée
- [ ] Les réponses "classiques" (sans INTERNAL) sont toujours mises en cache normalement
