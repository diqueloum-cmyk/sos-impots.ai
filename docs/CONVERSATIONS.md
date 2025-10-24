# 💬 Système de Conversations - Documentation

## Vue d'ensemble

Le système de conversations permet de **sauvegarder et gérer l'historique des conversations** des utilisateurs connectés avec le chatbot juridique.

### Fonctionnalités

✅ **Sessions de conversation** organisées (type ChatGPT)
✅ **Sauvegarde automatique** de toutes les questions/réponses pour utilisateurs connectés
✅ **Historique complet** avec métadonnées (tokens, temps de réponse, cache)
✅ **Gestion des sessions** (création, suppression, renommage)
✅ **Statistiques utilisateur** (total messages, tokens, sessions)

---

## 📊 Structure de la Base de Données

### Table: `conversation_sessions`

Stocke les sessions de conversation (une session = une conversation continue).

```sql
CREATE TABLE conversation_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) DEFAULT 'Nouvelle conversation',
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  message_count INTEGER DEFAULT 0
);
```

**Index:** `idx_session_user` sur `(user_id, last_message_at DESC)`

### Table: `conversation_messages`

Stocke les messages individuels (questions utilisateur + réponses assistant).

```sql
CREATE TABLE conversation_messages (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  tokens_used INTEGER DEFAULT 0,
  response_time_ms INTEGER,
  was_cached BOOLEAN DEFAULT FALSE
);
```

**Index:**
- `idx_messages_session` sur `(session_id, created_at)`
- `idx_messages_role` sur `(session_id, role)`

---

## 🔧 Installation

### 1. Créer les tables

Appelez l'endpoint de setup avec votre clé :

```bash
curl -X GET https://sosdivorce.fr/api/setup-db \
  -H "X-Setup-Key: votre-cle-setup"
```

Les tables `conversation_sessions` et `conversation_messages` seront créées automatiquement.

### 2. Vérifier la création

```bash
curl https://sosdivorce.fr/api/test-db
```

Vous devriez voir les nouvelles tables listées.

---

## 🚀 API Endpoints

### 1. Envoyer un message (avec sauvegarde)

**POST** `/api/chat`

```javascript
// Première question (crée une nouvelle session)
fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    message: 'Comment procéder pour un divorce ?'
  })
})
.then(res => res.json())
.then(data => {
  console.log('Réponse:', data.response);
  console.log('Session ID:', data.sessionId); // Nouveau champ !

  // Garder le sessionId pour les questions suivantes
  const sessionId = data.sessionId;
});

// Question suivante (même session)
fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    message: 'Quels sont les frais ?',
    sessionId: sessionId // Continuer la même conversation
  })
});
```

**Réponse:**
```json
{
  "success": true,
  "response": "Pour divorcer en France...",
  "qUsed": 3,
  "remaining": "illimité",
  "cached": false,
  "sessionId": 42
}
```

---

### 2. Récupérer toutes les sessions

**GET** `/api/conversations`

```javascript
fetch('/api/conversations', {
  credentials: 'include'
})
.then(res => res.json())
.then(data => {
  console.log('Sessions:', data.sessions);
});
```

**Réponse:**
```json
{
  "success": true,
  "sessions": [
    {
      "id": 42,
      "title": "Comment procéder pour un divorce ?",
      "startedAt": "2025-10-24T19:30:00Z",
      "lastMessageAt": "2025-10-24T19:35:00Z",
      "messageCount": 6
    },
    {
      "id": 41,
      "title": "Pension alimentaire",
      "startedAt": "2025-10-23T14:20:00Z",
      "lastMessageAt": "2025-10-23T14:25:00Z",
      "messageCount": 4
    }
  ],
  "count": 2
}
```

**Paramètres optionnels:**
- `limit=20` : Nombre maximum de sessions (défaut: 20)

---

### 3. Récupérer les messages d'une session

**GET** `/api/conversations?sessionId=42`

```javascript
fetch('/api/conversations?sessionId=42', {
  credentials: 'include'
})
.then(res => res.json())
.then(data => {
  console.log('Messages:', data.messages);
});
```

**Réponse:**
```json
{
  "success": true,
  "sessionId": 42,
  "messages": [
    {
      "id": 100,
      "role": "user",
      "content": "Comment procéder pour un divorce ?",
      "createdAt": "2025-10-24T19:30:00Z",
      "tokensUsed": 0,
      "responseTimeMs": null,
      "wasCached": false
    },
    {
      "id": 101,
      "role": "assistant",
      "content": "Pour divorcer en France, il existe plusieurs procédures...",
      "createdAt": "2025-10-24T19:30:03Z",
      "tokensUsed": 250,
      "responseTimeMs": 1250,
      "wasCached": false
    }
  ]
}
```

---

### 4. Récupérer les statistiques

**GET** `/api/conversations?action=stats`

```javascript
fetch('/api/conversations?action=stats', {
  credentials: 'include'
})
.then(res => res.json())
.then(data => {
  console.log('Stats:', data.stats);
});
```

**Réponse:**
```json
{
  "success": true,
  "stats": {
    "totalSessions": 15,
    "totalMessages": 120,
    "totalTokens": 45000,
    "cachedResponses": 30
  }
}
```

---

### 5. Supprimer une session

**DELETE** `/api/conversations?sessionId=42`

```javascript
fetch('/api/conversations?sessionId=42', {
  method: 'DELETE',
  credentials: 'include'
})
.then(res => res.json())
.then(data => {
  console.log('Session supprimée');
});
```

**Réponse:**
```json
{
  "success": true,
  "message": "Session supprimée avec succès"
}
```

---

### 6. Renommer une session

**PUT** `/api/conversations`

```javascript
fetch('/api/conversations', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    sessionId: 42,
    title: 'Mon divorce - Procédure'
  })
})
.then(res => res.json());
```

**Réponse:**
```json
{
  "success": true,
  "message": "Titre mis à jour avec succès"
}
```

---

## 💡 Comportement du Système

### Utilisateurs NON connectés

- ❌ Les conversations ne sont **PAS sauvegardées**
- ✅ Le cache global fonctionne toujours
- ✅ Limite de 2 questions gratuites

### Utilisateurs connectés

- ✅ **Toutes les conversations sont sauvegardées automatiquement**
- ✅ Chaque première question crée une nouvelle session
- ✅ Les questions suivantes avec `sessionId` continuent la session
- ✅ Titre auto-généré depuis les 50 premiers caractères de la 1ère question
- ✅ Questions illimitées

### Création de sessions

**Nouvelle session automatique** si :
- Aucun `sessionId` fourni dans la requête
- Utilisateur envoie une première question

**Continuation de session** si :
- `sessionId` fourni dans la requête
- Session appartient bien à l'utilisateur

### Suppression en cascade

Quand un utilisateur est supprimé :
- ✅ Toutes ses sessions sont supprimées (`ON DELETE CASCADE`)
- ✅ Tous les messages de ces sessions sont supprimés

Quand une session est supprimée :
- ✅ Tous les messages de cette session sont supprimés

---

## 📈 Métadonnées Collectées

Pour chaque message, on stocke :

| Métadonnée | Description | Exemple |
|------------|-------------|---------|
| `tokens_used` | Tokens OpenAI consommés | 250 |
| `response_time_ms` | Temps de réponse en ms | 1250 |
| `was_cached` | Réponse depuis le cache | `true/false` |

**Utilité:**
- 💰 Calculer les coûts API par utilisateur
- 📊 Analytics de performance
- 🎯 Identifier les questions populaires

---

## 🎨 Exemple d'Intégration Frontend

### Sidebar avec historique (type ChatGPT)

```html
<div class="sidebar">
  <h3>Conversations</h3>
  <div id="sessionList"></div>
</div>

<script>
// Charger les sessions
async function loadSessions() {
  const response = await fetch('/api/conversations', {
    credentials: 'include'
  });
  const data = await response.json();

  const sessionList = document.getElementById('sessionList');
  sessionList.innerHTML = data.sessions.map(session => `
    <div class="session" onclick="loadSession(${session.id})">
      <div class="title">${session.title}</div>
      <div class="count">${session.messageCount} messages</div>
    </div>
  `).join('');
}

// Charger une session spécifique
async function loadSession(sessionId) {
  const response = await fetch(`/api/conversations?sessionId=${sessionId}`, {
    credentials: 'include'
  });
  const data = await response.json();

  // Afficher les messages
  const chatContainer = document.getElementById('chatContainer');
  chatContainer.innerHTML = data.messages.map(msg => `
    <div class="message ${msg.role}">
      <div class="content">${msg.content}</div>
      ${msg.wasCached ? '<span class="badge">Cached</span>' : ''}
    </div>
  `).join('');

  // Utiliser ce sessionId pour les prochaines questions
  currentSessionId = sessionId;
}

// Envoyer une question
async function sendMessage(message) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      message: message,
      sessionId: currentSessionId // undefined pour nouvelle session
    })
  });

  const data = await response.json();
  currentSessionId = data.sessionId; // Mettre à jour le sessionId

  // Recharger la liste des sessions
  loadSessions();
}
</script>
```

---

## 🔐 Sécurité

### Contrôle d'accès

- ✅ Seuls les utilisateurs **connectés** peuvent accéder à `/api/conversations`
- ✅ Les utilisateurs ne peuvent voir que **leurs propres** conversations
- ✅ Vérification de propriété sur toutes les opérations (lecture, suppression, modification)

### Validation

- ✅ `sessionId` vérifié avant toute opération
- ✅ Titre limité à 255 caractères
- ✅ Protection contre l'injection SQL (requêtes paramétrées)

---

## 📊 Performance

### Indexes optimisés

- 🚀 Recherche rapide des sessions par utilisateur
- 🚀 Tri chronologique efficace
- 🚀 Chargement rapide des messages d'une session

### Taille des données

**Estimation pour 1000 utilisateurs actifs:**
- Sessions: ~10 Ko par utilisateur = 10 MB
- Messages: ~200 messages × 500 octets = 100 KB par utilisateur = 100 MB

**Total estimé: ~110 MB pour 1000 utilisateurs**

---

## 🐛 Dépannage

### Les conversations ne sont pas sauvegardées

**Vérifications:**
1. L'utilisateur est-il connecté ? (cookie `registered=1`)
2. Les tables sont-elles créées ? (`/api/test-db`)
3. Y a-t-il des erreurs dans les logs ? (Vercel dashboard)

### Erreur "Session non trouvée"

**Causes:**
- Session supprimée
- `sessionId` invalide
- Session n'appartient pas à l'utilisateur

### Erreur "Authentification requise"

**Solution:**
- Vérifier que l'utilisateur est connecté
- Vérifier les cookies (`registered`, `user_email`)

---

## 🚀 Évolutions Futures

### Possibilités d'amélioration

1. **Export de conversations** (PDF, JSON)
2. **Recherche full-text** dans les conversations
3. **Tags/catégories** pour organiser
4. **Partage de conversations** (URL publique)
5. **Résumé automatique** de conversations longues
6. **Favoris** pour marquer des réponses importantes
7. **Context awareness** : utiliser l'historique pour améliorer les réponses

---

## 📝 Logs

Le système log automatiquement :

```
✅ Nouvelle session créée: { sessionId: 42, userId: 10, title: "..." }
✅ Message ajouté: { messageId: 100, sessionId: 42, role: "user" }
✅ Conversation sauvegardée: { userId: 10, sessionId: 42, cached: false }
❌ Erreur sauvegarde conversation: [error details]
```

Les erreurs de sauvegarde **ne bloquent pas** les réponses du chatbot.

---

## 🎉 Résumé

Le système de conversations est maintenant **opérationnel** !

**Prochaines étapes recommandées:**
1. ✅ Exécuter `/api/setup-db` pour créer les tables
2. ✅ Tester avec un utilisateur connecté
3. ✅ Implémenter l'UI frontend pour afficher l'historique
4. ✅ Ajouter des analytics dans l'admin dashboard

**Questions ?** Consultez les logs Vercel ou testez avec `/api/test-db`.
