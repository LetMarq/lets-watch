// Watch page.
//
// 1. Connects to the PeerJS server with a random id.
// 2. Opens a data connection to the presenter ("letswatch-<code>").
//    If they haven't arrived yet, tries again every few seconds.
// 3. When the presenter shares the screen, they call here and the video
//    shows up in the <video>.
import { REACTIONS, codeFromUrl, launchEmoji, loadConfig, peerOptions, plural, presenterPeerId } from './common.js';
import { createStatic } from './retro.js';

const RETRY_INTERVAL_MS = 3000;
const CONNECT_TIMEOUT_MS = 12000;
// New key: people who visited back when CRT was on by default also start with it off.
const CRT_STORAGE_KEY = 'letswatch-crt-v2';

const $ = (id) => document.getElementById(id);
const el = {
  stage: $('stage'),
  video: $('video'),
  notice: $('notice'),
  noticeLayer: $('notice-layer'),
  noticeTitle: $('notice-title'),
  noticeText: $('notice-text'),
  noticeLink: $('notice-link'),
  staticCanvas: $('static'),
  staticBar: $('static-bar'),
  title: $('title'),
  osdPlay: $('osd-play'),
  liveBadge: $('live-badge'),
  viewers: $('viewers'),
  unmute: $('unmute'),
  soundBtn: $('sound-btn'),
  iconMuted: $('icon-muted'),
  iconSound: $('icon-sound'),
  crtBtn: $('crt-btn'),
  fillBtn: $('fill-btn'),
  pipBtn: $('pip-btn'),
  fullscreenBtn: $('fullscreen-btn'),
  reactionsLayer: $('reactions'),
  tray: $('reactions-tray'),
  reactionsBtn: $('reactions-btn'),
};

const code = codeFromUrl();
const presenterId = code && presenterPeerId(code);
const staticNoise = createStatic(el.staticCanvas);

let peer = null;
let connection = null;
let call = null;
let retryTimer = null;
let ended = false;
let hasTurn = false;
let reactionsAllowed = false;

// ---------- Waiting screens ----------
// 'static' = TV off the air (no signal / tuning)
// 'blue'   = VCR blue screen (paused, end of tape, error)

function showNotice(title, text = '', kind = 'static') {
  el.notice.classList.remove('hidden');
  el.noticeTitle.textContent = title;
  el.noticeText.textContent = text;
  el.noticeLink.classList.add('hidden');

  const blue = kind === 'blue';
  el.noticeLayer.classList.toggle('blue-screen', blue);
  el.staticCanvas.classList.toggle('hidden', blue);
  el.staticBar.classList.toggle('hidden', blue);
  if (blue) staticNoise.stop();
  else staticNoise.start();
}

function hideNotice() {
  el.notice.classList.add('hidden');
  staticNoise.stop();
}

function setLive(live) {
  el.liveBadge.classList.toggle('hidden', !live);
}

// ---------- Connection to the presenter ----------

function scheduleRetry() {
  if (ended || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connectToPresenter();
  }, RETRY_INTERVAL_MS);
}

function waitingForPresenter() {
  setLive(false);
  showNotice('Sem sinal', 'Aguardando o apresentador. Pode deixar esta página aberta.');
}

function connectToPresenter() {
  if (ended || !peer || peer.disconnected || peer.destroyed) return;
  connection?.close();
  const conn = peer.connect(presenterId, { reliable: true });
  connection = conn;

  // If it doesn't open within a few seconds, the presenter exists but the
  // network blocked the direct connection. Warn and try again.
  const timeout = setTimeout(() => {
    if (!conn.open && connection === conn) {
      conn.close();
      if (!el.video.srcObject) {
        showNotice(
          'Sem conexão direta',
          hasTurn
            ? 'A rede bloqueou a conexão com o apresentador. Tentando de novo... Se continuar, cadastre um TURN seu.'
            : 'A rede bloqueou a conexão com o apresentador. Cadastre um TURN seu para resolver.',
          'blue',
        );
        el.noticeLink.classList.remove('hidden');
      }
      scheduleRetry();
    }
  }, CONNECT_TIMEOUT_MS);

  conn.on('open', () => {
    clearTimeout(timeout);
    updateReactionsButton();
  });
  conn.on('data', handleMessage);
  conn.on('close', () => {
    clearTimeout(timeout);
    if (connection !== conn || ended) return;
    connection = null;
    updateReactionsButton();
    stopVideo();
    waitingForPresenter();
    scheduleRetry();
  });
}

function handleMessage(message) {
  if (ended) return;
  if (message?.type === 'reaction') {
    // Our own emoji already showed up when we clicked.
    if (message.from !== peer?.id) launchEmoji(el.reactionsLayer, message.emoji);
    return;
  }
  if (message?.type === 'ended') {
    endWatching(message.reason);
    return;
  }
  if (message?.type !== 'state') return;

  const title = message.title || 'Live no LetsWatch';
  el.title.textContent = title;
  document.title = `${title} · LetsWatch`;
  el.viewers.textContent = plural(message.viewers, 'pessoa', 'pessoas');
  setLive(message.live);
  reactionsAllowed = message.reactions !== false;
  updateReactionsButton();

  if (!message.live) {
    stopVideo();
    showNotice('❚❚ Pausa', 'O apresentador está na sala. A tela aparece assim que ele apertar play.', 'blue');
  } else if (!el.video.srcObject) {
    showNotice('Sintonizando...', 'Carregando a tela');
  }
}

function receiveCall(incoming) {
  // Only accept video from this room's presenter.
  if (incoming.peer !== presenterId) {
    incoming.close();
    return;
  }
  call?.close();
  call = incoming;
  incoming.answer(); // we only receive; we send nothing
  incoming.on('stream', (stream) => {
    if (call !== incoming) return;
    el.video.srcObject = stream;
    play();
  });
  incoming.on('close', () => {
    if (call === incoming) stopVideo();
  });
}

function stopVideo() {
  call?.close();
  call = null;
  el.video.srcObject = null;
  el.osdPlay.classList.add('hidden');
  el.unmute.classList.add('hidden');
}

function endWatching(reason = '') {
  ended = true;
  updateReactionsButton();
  clearTimeout(retryTimer);
  stopVideo();
  setLive(false);
  el.viewers.textContent = '';
  if (reason === 'admin') {
    showNotice('■ Fim da fita', 'A live foi encerrada pelo administrador.', 'blue');
  } else {
    showNotice('■ Fim da fita', 'A live terminou. Obrigada por assistir!', 'blue');
  }
  setTimeout(() => peer?.destroy(), 300);
}

// ---------- Video and sound ----------
// Browsers only allow playing with sound after a click on the page.
// So we start muted and show the "Ativar som" button.

async function play() {
  try {
    await el.video.play();
  } catch {
    // not allowed to play yet; the sound button fixes it
  }
  hideNotice();
  el.osdPlay.classList.remove('hidden');
  // "TV power-on" effect
  el.video.classList.remove('power-on');
  void el.video.offsetWidth;
  el.video.classList.add('power-on');
  updateSound();
}

function updateSound() {
  const muted = el.video.muted;
  el.iconMuted.classList.toggle('hidden', !muted);
  el.iconSound.classList.toggle('hidden', muted);
  el.unmute.classList.toggle('hidden', !muted || !el.video.srcObject);
}

function toggleSound() {
  el.video.muted = !el.video.muted;
  el.video.play().catch(() => {});
  updateSound();
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
    return;
  }
  // In fullscreen the controls are hidden, so turn the sound on here
  // (the click counts as the browser's permission to play with sound).
  if (el.video.muted && el.video.srcObject) {
    el.video.muted = false;
    el.video.play().catch(() => {});
    updateSound();
  }
  if (el.stage.requestFullscreen) {
    el.stage.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  } else if (el.video.webkitEnterFullscreen) {
    el.video.webkitEnterFullscreen(); // iPhone
  }
}

// In fullscreen, hide everything and show only the screen. To leave: Esc, F or double click.
document.addEventListener('fullscreenchange', () => {
  el.stage.classList.toggle('fullscreen', Boolean(document.fullscreenElement));
});

async function togglePip() {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await el.video.requestPictureInPicture();
  } catch (error) {
    console.warn(error);
  }
}

function toggleFill() {
  const active = el.stage.classList.toggle('fill');
  el.fillBtn.classList.toggle('active', active);
}

// ---------- Reactions (emojis) ----------

for (const emoji of REACTIONS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = emoji;
  button.setAttribute('aria-label', `Enviar ${emoji}`);
  button.addEventListener('click', () => sendReaction(emoji));
  el.tray.append(button);
}

function openTray(open) {
  el.tray.classList.toggle('hidden', !open);
  el.reactionsBtn.classList.toggle('active', open);
  el.reactionsBtn.setAttribute('aria-expanded', String(open));
}

// The button only shows up with the presenter connected and reactions on.
function updateReactionsButton() {
  const allowed = reactionsAllowed && Boolean(connection?.open) && !ended;
  el.reactionsBtn.classList.toggle('hidden', !allowed);
  if (!allowed) openTray(false);
}

let lastReaction = 0;
function sendReaction(emoji) {
  const now = Date.now();
  if (now - lastReaction < 350 || !connection?.open) return; // no emoji machine gun
  lastReaction = now;
  connection.send({ type: 'reaction', emoji });
  launchEmoji(el.reactionsLayer, emoji);
}

el.reactionsBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  openTray(el.tray.classList.contains('hidden'));
});
document.addEventListener('click', (event) => {
  if (!el.tray.contains(event.target)) openTray(false);
});

// Tube TV effect (scanlines and dark corners). Saved in this browser.
function setCrt(active) {
  el.stage.classList.toggle('crt', active);
  el.crtBtn.classList.toggle('active', active);
  el.crtBtn.setAttribute('aria-pressed', String(active));
  try {
    localStorage.setItem(CRT_STORAGE_KEY, active ? '1' : '0');
  } catch {
    // private window or blocked storage: that's fine
  }
}

// Starts OFF. Only turns on if the person enabled CRT before in this browser.
function savedCrt() {
  try {
    return localStorage.getItem(CRT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

// Hides the controls after a few seconds without moving the mouse.
let idleTimer;
function showControls() {
  el.stage.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (el.video.srcObject) el.stage.classList.add('idle');
  }, 3000);
}

// ---------- Startup ----------

async function init() {
  setCrt(savedCrt());

  if (!code) {
    showNotice('Erro de leitura', 'Link inválido. Confira se ele foi copiado inteiro.', 'blue');
    return;
  }

  showNotice('Sintonizando...');
  const config = await loadConfig();
  hasTurn = Boolean(config.hasTurn);
  peer = new Peer(peerOptions(config));

  peer.on('open', () => connectToPresenter());
  peer.on('call', receiveCall);

  peer.on('disconnected', () => {
    if (ended) return;
    setTimeout(() => {
      if (!peer.destroyed && peer.disconnected) peer.reconnect();
    }, 2000);
  });

  peer.on('error', (error) => {
    if (error.type === 'peer-unavailable') {
      // The presenter hasn't opened the panel yet (or left).
      if (!el.video.srcObject) waitingForPresenter();
      scheduleRetry();
    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(error.type)) {
      if (!el.video.srcObject) showNotice('Reconectando...', 'Verificando sua conexão com a internet.');
    } else {
      console.warn('PeerJS:', error.type, error);
    }
  });
}

el.unmute.addEventListener('click', toggleSound);
el.soundBtn.addEventListener('click', toggleSound);
el.fullscreenBtn.addEventListener('click', toggleFullscreen);
el.fillBtn.addEventListener('click', toggleFill);
el.crtBtn.addEventListener('click', () => setCrt(!el.stage.classList.contains('crt')));
el.video.addEventListener('dblclick', toggleFullscreen);

if (document.pictureInPictureEnabled) el.pipBtn.addEventListener('click', togglePip);
else el.pipBtn.classList.add('hidden');

// When the tab closes, disconnect right away so the presenter's count updates.
window.addEventListener('pagehide', () => peer?.destroy());

document.addEventListener('pointermove', showControls);
document.addEventListener('keydown', (event) => {
  if (event.target.closest('input, textarea')) return;
  if (event.key === 'f' || event.key === 'F') toggleFullscreen();
  if (event.key === 'm' || event.key === 'M') toggleSound();
  showControls();
});

init();
