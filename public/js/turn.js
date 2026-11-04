// /turn page: anyone can save their own TURN in this browser.
// It lives in localStorage and is put FIRST in the server list (see
// loadConfig in common.js). Chrome gives more priority to the TURN servers
// that come first in the list; the site's one stays as a fallback.
import { browserTurns, saveBrowserTurns } from './common.js';

const TEST_TIMEOUT_MS = 8000;

const $ = (id) => document.getElementById(id);
const display = $('display');
const form = $('turn-form');
const saveBtn = $('save');

function show(text, state = '') {
  display.textContent = text;
  display.dataset.state = state;
}

// "turn:free.expressturn.com:3478" or "free.expressturn.com" → "free.expressturn.com:3478"
function cleanAddress(text) {
  let address = text.trim().replace(/^turns?:/i, '').replace(/\?.*$/, '').replace(/\/+$/, '');
  if (!/:\d+$/.test(address)) address += ':3478';
  return address;
}

function buildServer(address, username, password) {
  return {
    urls: [`turn:${address}`, `turn:${address}?transport=tcp`],
    username: username.trim(),
    credential: password.trim(),
  };
}

// Really tests the TURN: asks the browser for a path ONLY through the TURN
// ("relay"). If a relay candidate shows up, username, password and quota are fine.
async function testServer(server) {
  const pc = new RTCPeerConnection({ iceServers: [server], iceTransportPolicy: 'relay' });
  try {
    pc.createDataChannel('test');
    const result = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), TEST_TIMEOUT_MS);
      pc.addEventListener('icecandidate', (event) => {
        if (event.candidate && / typ relay /.test(event.candidate.candidate)) {
          clearTimeout(timeout);
          resolve(true);
        } else if (!event.candidate) {
          clearTimeout(timeout);
          resolve(false); // finished searching without finding a path through the TURN
        }
      });
    });
    await pc.setLocalDescription(await pc.createOffer());
    return await result;
  } catch {
    return false;
  } finally {
    pc.close();
  }
}

function render() {
  const [saved] = browserTurns();
  $('saved').classList.toggle('hidden', !saved);
  $('form-title').textContent = saved ? 'Trocar por outro TURN' : 'Cadastrar um TURN';
  if (saved) {
    $('saved-server').textContent = String(saved.urls?.[0] ?? '').replace(/^turn:/, '');
    $('saved-user').textContent = `usuário ${saved.username}`;
    show('Usando o SEU TURN primeiro', 'ok');
  } else {
    show('Usando o TURN do site');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const server = buildServer(cleanAddress($('server').value), $('username').value, $('password').value);

  saveBtn.disabled = true;
  show('Testando...');
  const works = await testServer(server);
  saveBtn.disabled = false;

  if (!works) {
    show('Não funcionou. Confira usuário e senha (ou a cota acabou).', 'error');
    return;
  }
  if (!saveBrowserTurns([server])) {
    show('Funciona, mas este navegador não deixou salvar (janela anônima?).', 'error');
    return;
  }
  form.reset();
  render();
  show('Funcionando! Salvo neste navegador.', 'ok');
});

$('test-saved').addEventListener('click', async () => {
  const [saved] = browserTurns();
  if (!saved) return;
  show('Testando...');
  const works = await testServer(saved);
  show(
    works ? 'Seu TURN está funcionando.' : 'Seu TURN não respondeu (cota acabou ou senha mudou?).',
    works ? 'ok' : 'error',
  );
});

$('remove').addEventListener('click', () => {
  saveBrowserTurns([]);
  render();
  show('Removido. Usando o TURN do site.');
});

render();
