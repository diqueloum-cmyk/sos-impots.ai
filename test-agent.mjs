import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse as parseYaml } from 'yaml';
import readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Charger le system prompt
const agentConfig = parseYaml(readFileSync(join(__dirname, 'agent_console.yaml'), 'utf-8'));
const systemPrompt = agentConfig.system;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.argv[2]
});

const history = [];

function parseResponse(fullText) {
  let display = fullText.replace('[[QUESTION-GRATUITE-UTILISEE]]', '').trim();
  const idx = display.indexOf('---INTERNAL---');
  if (idx !== -1) {
    const json = display.substring(idx + '---INTERNAL---'.length).trim();
    display = display.substring(0, idx).trim();
    try {
      const data = JSON.parse(json);
      return { display, internal: data };
    } catch {}
  }
  return { display, internal: null };
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('\n\x1b[36m━━━ Test Agent SOS-IMPOTS.AI ━━━\x1b[0m');
console.log('\x1b[90mSystem prompt chargé (' + systemPrompt.length + ' chars). Tapez "exit" pour quitter.\x1b[0m\n');

function ask() {
  rl.question('\x1b[32mVous:\x1b[0m ', async (input) => {
    if (!input.trim() || input.trim() === 'exit') { rl.close(); return; }

    history.push({ role: 'user', content: input });

    try {
      process.stdout.write('\x1b[33mAgent:\x1b[0m ');

      const res = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        temperature: 0,
        system: systemPrompt,
        messages: history
      });

      const fullText = res.content[0].text;
      const { display, internal } = parseResponse(fullText);

      // Stocker le texte brut (avec marqueurs) dans l'historique
      history.push({ role: 'assistant', content: fullText });

      console.log(display);

      if (internal) {
        console.log('\n\x1b[90m[INTERNAL] ' + JSON.stringify(internal) + '\x1b[0m');
        if (internal.offre_choisie) {
          const LINKS = {
            express_39: 'https://buy.stripe.com/3cIbJ09wqa4i5tMff0ejK00',
            premium_99: 'https://buy.stripe.com/bJe28qfUOa4i2hAff0ejK01'
          };
          const url = LINKS[internal.offre_choisie];
          if (url) console.log('\x1b[36m[PAIEMENT] ' + url + '\x1b[0m');
        }
      }

      const marker = fullText.includes('[[QUESTION-GRATUITE-UTILISEE]]');
      if (marker) console.log('\x1b[90m[marqueur QUESTION-GRATUITE-UTILISEE présent dans historique]\x1b[0m');

      console.log('\x1b[90m[tokens: ' + res.usage.input_tokens + ' in / ' + res.usage.output_tokens + ' out]\x1b[0m\n');

    } catch (err) {
      console.error('\x1b[31mErreur:\x1b[0m', err.message);
    }

    ask();
  });
}

ask();
