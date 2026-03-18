# P0-01 — Supprimer la FK vers la table `users` inexistante

## Contexte

Dans `lib/db.js`, la table `conversation_sessions` déclare une clé étrangère `REFERENCES users(id)` mais la table `users` n'est jamais créée nulle part dans le code. La migration `migrateConversationTablesForAnonymous()` rend `user_id` nullable, ce qui contourne le problème en pratique, mais la contrainte FK reste dangereuse.

## Fichiers concernés

- `lib/db.js` — définition de la table
- `api/setup-db.js` — migration initiale

## Comportement actuel

```sql
-- lib/db.js ligne 203
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- ❌ users n'existe pas
  ...
)
```

## Comportement attendu

Supprimer la contrainte FK vers `users` et garder `user_id` comme simple colonne nullable sans référence :

```sql
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,  -- colonne simple, pas de FK
  ...
)
```

## Étapes

1. Dans `lib/db.js`, supprimer `REFERENCES users(id) ON DELETE CASCADE` de la définition de `conversation_sessions`
2. Vérifier que `api/setup-db.js` ne fait pas de référence à `users` non plus
3. Vérifier qu'aucune autre table ne fait `REFERENCES users(id)`

## Critères de validation

- [x] La table `conversation_sessions` ne référence plus `users`
- [x] Le setup-db fonctionne sans erreur FK sur une base vierge
- [x] Les sessions anonymes s'insèrent correctement
