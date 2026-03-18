# P2-01 — Nettoyage automatique des sessions anonymes

## Contexte

Les sessions anonymes créées dans `conversation_sessions` et leurs messages dans `conversation_messages` ne sont jamais supprimés automatiquement. Elles s'accumulent indéfiniment en base PostgreSQL, ce qui peut poser des problèmes de stockage et de conformité RGPD à terme.

## Fichiers concernés

- `lib/db.js` — ajouter une fonction de nettoyage
- `api/setup-db.js` — exposer un endpoint de nettoyage (ou documenter l'appel)

## Comportement attendu

Supprimer les sessions anonymes (et leurs messages en cascade) plus vieilles que 30 jours.

## Implémentation

### 1. Ajouter une fonction dans `lib/db.js`

```js
export async function deleteOldAnonymousSessions(daysOld = 30) {
  const result = await sql`
    DELETE FROM conversation_sessions
    WHERE is_anonymous = true
      AND last_message_at < NOW() - INTERVAL '${daysOld} days'
  `;
  return result.rowCount;
}
```

Les messages sont supprimés en cascade si la FK `ON DELETE CASCADE` est présente sur `conversation_messages`.

### 2. Exposer via un endpoint admin

Dans `api/admin-conversations.js`, ajouter une action `?action=cleanup` :

```js
if (action === 'cleanup') {
  const deleted = await deleteOldAnonymousSessions(30);
  return res.status(200).json({ deleted });
}
```

Protégé par `X-Admin-Key` comme les autres actions admin.

### 3. (Optionnel) Appel automatique

Appeler `deleteOldAnonymousSessions()` depuis l'endpoint `/api/health` ou via un cron Vercel si disponible.

## Points de vigilance

- Vérifier que `conversation_messages` a bien `ON DELETE CASCADE` sur `session_id`
- Ne pas supprimer les sessions liées à une commande (`orders.session_id`)

## Critères de validation

- [ ] La fonction `deleteOldAnonymousSessions()` existe dans `lib/db.js`
- [ ] Un appel via `GET /api/admin-conversations?action=cleanup` (avec X-Admin-Key) déclenche le nettoyage
- [ ] Les sessions liées à des orders ne sont pas supprimées
- [ ] Les messages orphelins sont supprimés en cascade
