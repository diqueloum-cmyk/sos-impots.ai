import http from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse as parseYaml } from 'yaml';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3333;

// Charger le system prompt
const agentConfig = parseYaml(readFileSync(join(__dirname, 'agent_console.yaml'), 'utf-8'));
const systemPrompt = agentConfig.system;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Historique en mémoire par session
const sessions = new Map();

const STRIPE_LINKS = {
  express_39: 'https://buy.stripe.com/3cIbJ09wqa4i5tMff0ejK00',
  premium_99: 'https://buy.stripe.com/bJe28qfUOa4i2hAff0ejK01'
};

function parseAgentResponse(fullText) {
  let display = fullText.replace('[[QUESTION-GRATUITE-UTILISEE]]', '').trim();
  const idx = display.indexOf('---INTERNAL---');
  if (idx !== -1) {
    const json = display.substring(idx + '---INTERNAL---'.length).trim();
    display = display.substring(0, idx).trim();
    try { return { display, internal: JSON.parse(json) }; } catch {}
  }
  return { display, internal: null };
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Servir la page de test
  if (req.method === 'GET' && (req.url === '/' || req.url === '/test')) {
    const html = readFileSync(join(__dirname, 'public', 'test-chat.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Endpoint chat
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { message, sessionId } = JSON.parse(body);
        if (!message?.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Message requis' }));
          return;
        }

        // Récupérer ou créer l'historique de session
        const sid = sessionId || Math.random().toString(36).slice(2);
        if (!sessions.has(sid)) sessions.set(sid, []);
        const history = sessions.get(sid);

        history.push({ role: 'user', content: message });

        const claudeRes = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          temperature: 0,
          system: systemPrompt,
          messages: history
        });

        const fullText = claudeRes.content[0].text;
        // Stocker le texte brut (avec marqueurs) dans l'historique
        history.push({ role: 'assistant', content: fullText });

        const { display, internal } = parseAgentResponse(fullText);

        let paymentUrl = null;
        if (internal?.offre_choisie) {
          paymentUrl = STRIPE_LINKS[internal.offre_choisie] || null;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          response: display,
          sessionId: sid,
          paymentUrl,
          offreChoisie: internal?.offre_choisie || null,
          cached: false
        }));

      } catch (err) {
        console.error('Erreur:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n\x1b[36m━━━ Serveur de test SOS-IMPOTS.AI ━━━\x1b[0m`);
  console.log(`\x1b[32m✓ http://localhost:${PORT}\x1b[0m`);
  console.log(`\x1b[90mHistorique en mémoire — pas de base de données\x1b[0m\n`);
});
