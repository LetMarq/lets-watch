// /admin page: ends the live of any open room.
//
// 1. Checks the password on the server (/api/admin) and gets a token for the room.
// 2. Connects to the presenter panel through PeerJS, with the "admin" role.
// 3. Sends the command with the token. The panel checks the token and ends the live.
import { loadConfig, peerOptions, presenterPeerId } from './common.js';

const TIMEOUT_MS = 15000;

const $ = (id) => document.getElementById(id);
const form = $('admin-form');
const passwordField = $('password');
const roomField = $('room');
const endBtn = $('end-btn');
const display = $('display');

let config = null;

function show(text, state = '') {
  display.textContent = text;
  display.dataset.state = state; // '', 'ok' or 'error'
}

// Accepts the watch link, the panel link or just the code.
function extractCode(text) {
  const clean = text.trim();
  const fromLink = clean.match(/\/(?:ver|transmitir)\/([A-Za-z0-9]{8})(?:[/?#]|$)/);
  if (fromLink) return fromLink[1];
  return /^[A-Za-z0-9]{8}$/.test(clean) ? clean : null;
}

async function requestToken(password, code) {
  const response = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, code }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro ${response.status}`);
  return data.token;
}

// Connects to the panel and sends the command. Resolves with a success message.
function sendEndCommand(code, token) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerOptions(config));
    let done = false;
    let connected = false; // did the connection to the panel open at all?

    const finish = (error, message) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      setTimeout(() => peer.destroy(), 300);
      if (error) reject(new Error(error));
      else resolve(message);
    };

    const timeout = setTimeout(() => {
      if (connected) {
        // Connected, but the panel didn't answer the command: it is running an
        // old version of the site, from before the admin option existed.
        finish('O painel do apresentador está com uma versão antiga do site. Peça para recarregar o painel (F5) e tente de novo.');
      } else {
        finish('Não deu para conectar ao painel do apresentador (a rede pode ter bloqueado). Tente de novo em instantes.');
      }
    }, TIMEOUT_MS);

    peer.on('error', (error) => {
      if (error.type === 'peer-unavailable') {
        finish('Essa live não está aberta agora: o painel do apresentador está fechado ou a live já terminou.');
      } else {
        finish(`Erro de conexão (${error.type}).`);
      }
    });

    peer.on('open', () => {
      const conn = peer.connect(presenterPeerId(code), { reliable: true, metadata: { role: 'admin' } });
      conn.on('open', () => {
        connected = true;
        conn.send({ type: 'admin-end', token });
      });
      conn.on('data', (message) => {
        if (message?.type === 'admin-ok') finish(null, `Live ${code} encerrada.`);
        if (message?.type === 'admin-denied') finish('O painel recusou o comando (token inválido).');
      });
    });
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = extractCode(roomField.value);
  if (!code) {
    show('Link ou código inválido', 'error');
    return;
  }

  endBtn.disabled = true;
  try {
    show('Conferindo senha...');
    const token = await requestToken(passwordField.value, code);
    show('Conectando à live...');
    config ??= await loadConfig();
    show(await sendEndCommand(code, token), 'ok');
    roomField.value = '';
  } catch (error) {
    show(error.message, 'error');
  } finally {
    endBtn.disabled = false;
  }
});
