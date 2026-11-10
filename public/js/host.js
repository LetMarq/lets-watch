// Presenter panel.
//
// How it works:
// 1. Registers on PeerJS with the id "letswatch-<code>".
// 2. Each viewer opens a data connection to that id (to receive the title,
//    viewer count and notices).
// 3. While the screen is being shared, the presenter "calls" (peer.call) each
//    viewer with the video. The video goes directly, browser to browser.
import {
  REACTIONS,
  codeFromUrl,
  copyText,
  launchEmoji,
  loadConfig,
  peerOptions,
  presenterPeerId,
} from './common.js';
import { createStatic, formatTime } from './retro.js';

// Labels are shown in the panel, so they stay in Portuguese.
// degradation: what the browser gives up when the internet can't keep up.
// - 'maintain-framerate': lowers the resolution but keeps the motion smooth
//   (for videos and games: avoids the "slideshow" effect);
// - 'maintain-resolution': keeps text sharp and drops frames (for slides and code).
const QUALITY_PRESETS = {
  smooth: { width: 1280, height: 720, fps: 30, hint: 'motion', degradation: 'maintain-framerate', bitrate: 2_500_000, label: '720p, 30 fps · vídeos e jogos, usa menos internet' },
  movie: { width: 1920, height: 1080, fps: 30, hint: 'motion', degradation: 'maintain-framerate', bitrate: 4_500_000, label: '1080p, 30 fps · precisa de mais upload' },
  text: { width: 1920, height: 1080, fps: 15, hint: 'detail', degradation: 'maintain-resolution', bitrate: 2_500_000, label: '1080p, 15 fps · slides, código, documentos (trava em vídeos)' },
};
const STATS_INTERVAL_MS = 2000;

// Saving resources: with nobody watching, sharing pauses by itself and, after
// a long idle time, the room closes (disconnects from the signaling server).
const PAUSE_WITHOUT_VIEWERS_MS = 5 * 60_000; // 5 min sharing to nobody
const CLOSE_IDLE_ROOM_MS = 30 * 60_000; // 30 min not sharing and nobody watching
const WARN_BEFORE_CLOSE_MS = 2 * 60_000;

// Max reactions per viewer: 6 every 3 seconds.
const REACTION_LIMIT = 6;
const REACTION_WINDOW_MS = 3000;

const $ = (id) => document.getElementById(id);
const el = {
  title: $('title'),
  status: $('status'),
  preview: $('preview'),
  previewEmpty: $('preview-empty'),
  previewLabel: $('preview-label'),
  presentBtn: $('present-btn'),
  liveControls: $('live-controls'),
  switchScreen: $('switch-screen'),
  stop: $('stop'),
  endLive: $('end-live'),
  quality: $('quality'),
  qualityHint: $('quality-hint'),
  viewerCount: $('viewer-count'),
  viewerCountLabel: $('viewer-count-label'),
  watchLink: $('watch-link'),
  copyLink: $('copy-link'),
  supportNotice: $('support-notice'),
  osdState: $('osd-state'),
  counter: $('counter'),
  led: $('led'),
  idleNotice: $('idle-notice'),
  noAudioNotice: $('no-audio-notice'),
  systemAudioNotice: $('system-audio-notice'),
  reactionsEnabled: $('reactions-enabled'),
  reactionsLayer: $('reactions'),
  sendStats: $('send-stats'),
};

// Monitor shows "no signal" static while nothing is being presented.
const staticNoise = createStatic($('static'));
staticNoise.start();

// Tape counter: how long the screen has been on air.
let onAirSince = 0;
setInterval(() => {
  el.counter.textContent = onAirSince ? formatTime(Date.now() - onAirSince) : '00:00:00';
}, 500);

const code = codeFromUrl();
const params = new URLSearchParams(location.search);
const key = params.get('k');

/** @type {Map<string, {conn: any, call: any}>} */
const viewers = new Map();

let peer = null;
let currentScreen = null; // MediaStream from getDisplayMedia
let outgoingStream = null; // MediaStream sent to viewers (screen video + audio)
let silentTrack = null; // used while the shared screen has no audio
let ended = false;

// ---------- Message screens ----------

function showMessage(title, text = '', { loading = false, action = true } = {}) {
  $('panel').classList.add('hidden');
  $('message').classList.remove('hidden');
  $('message-title').textContent = title;
  $('message-text').textContent = text;
  $('message-loading').classList.toggle('hidden', !loading);
  $('message-action').classList.toggle('hidden', !action);
}

function showPanel() {
  $('message').classList.add('hidden');
  $('panel').classList.remove('hidden');
}

function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind ? `status-${kind}` : ''}`;
}

function updateStatus() {
  if (ended) return;
  if (!peer || peer.disconnected) setStatus('Reconectando', 'warning');
  else if (outgoingStream) setStatus('● No ar', 'live');
  else setStatus('Pronto', 'ok');

  // OSD inside the monitor
  const live = Boolean(outgoingStream);
  el.osdState.textContent = live ? '● REC' : 'Standby';
  el.osdState.classList.toggle('rec', live);
  el.osdState.classList.toggle('blink', live);
  el.led.classList.toggle('on', live);
}

// ---------- Talking to viewers ----------

function currentState() {
  return {
    type: 'state',
    title: el.title.value.trim(),
    live: Boolean(outgoingStream),
    viewers: viewers.size,
    reactions: el.reactionsEnabled.checked,
  };
}

function broadcast(message) {
  for (const { conn } of viewers.values()) {
    if (conn.open) conn.send(message);
  }
}

function updateViewerCount() {
  const count = viewers.size;
  el.viewerCount.textContent = String(count).padStart(2, '0');
  el.viewerCountLabel.textContent = count === 1 ? 'pessoa assistindo' : 'pessoas assistindo';
  broadcast(currentState());
}

function removeViewer(id) {
  const viewer = viewers.get(id);
  if (!viewer) return;
  viewer.call?.close();
  viewers.delete(id);
  reactionHistory.delete(id);
  lastBytes.delete(id);
  updateViewerCount();
}

// ---------- Reactions (emojis) ----------
// A viewer sends an emoji here; if reactions are enabled, we forward it to
// everyone and show it on the monitor.
const reactionHistory = new Map(); // peerId → timestamps of recent emojis

function canReact(id) {
  const now = Date.now();
  const recent = (reactionHistory.get(id) ?? []).filter((time) => now - time < REACTION_WINDOW_MS);
  if (recent.length >= REACTION_LIMIT) return false;
  recent.push(now);
  reactionHistory.set(id, recent);
  return true;
}

function handleViewerMessage(conn, message) {
  if (message?.type !== 'reaction') return;
  if (!el.reactionsEnabled.checked || !REACTIONS.includes(message.emoji) || !canReact(conn.peer)) return;
  broadcast({ type: 'reaction', emoji: message.emoji, from: conn.peer });
  launchEmoji(el.reactionsLayer, message.emoji);
}

// ---------- Calls ----------

function applySendQuality(call) {
  const pc = call.peerConnection;
  if (!pc) return;
  const apply = async () => {
    const { bitrate, degradation } = QUALITY_PRESETS[el.quality.value];
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) continue;
      parameters.encodings[0].maxBitrate = bitrate;
      parameters.degradationPreference = degradation;
      try {
        await sender.setParameters(parameters);
      } catch {
        // Some browsers reject degradationPreference: apply at least the bitrate.
        delete parameters.degradationPreference;
        try {
          await sender.setParameters(parameters);
        } catch (error) {
          console.warn('Could not adjust the quality:', error);
        }
      }
    }
  };
  if (pc.connectionState === 'connected') apply();
  else pc.addEventListener('connectionstatechange', () => pc.connectionState === 'connected' && apply());
}

function callViewer(id) {
  const viewer = viewers.get(id);
  if (!viewer || !outgoingStream) return;
  viewer.call?.close();
  const call = peer.call(id, outgoingStream);
  viewer.call = call;
  applySendQuality(call);
  call.on('error', (error) => console.warn('Call error with', id, error));
}

// If a viewer loses internet or their computer sleeps, the connection doesn't
// say it closed. Every few seconds we drop the ones that died.
setInterval(() => {
  for (const [id, { conn }] of viewers) {
    const state = conn.peerConnection?.connectionState;
    if (!conn.open || state === 'failed' || state === 'closed') removeViewer(id);
  }
}, 5000);

// ---------- Send stats (shown under the viewer count) ----------
// Every 2 s we ask the browser how the video is actually going out to each
// viewer: resolution, fps, bitrate, whether the connection is direct or goes
// through a TURN server, and what is holding the quality back (if anything).
// This is what tells us WHY the picture is choppy.

const lastBytes = new Map(); // peerId → { bytes, time }

async function viewerStats(id, call) {
  const pc = call?.peerConnection;
  if (!pc || pc.connectionState !== 'connected') return null;
  const report = await pc.getStats();
  let video = null;
  let pair = null;
  report.forEach((stat) => {
    if (stat.type === 'outbound-rtp' && stat.kind === 'video') video = stat;
    if (stat.type === 'transport' && stat.selectedCandidatePairId) pair = report.get(stat.selectedCandidatePairId);
  });
  if (!pair) report.forEach((stat) => { if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded') pair = stat; });
  if (!video) return null;

  const now = Date.now();
  const previous = lastBytes.get(id);
  lastBytes.set(id, { bytes: video.bytesSent, time: now });
  const mbps = previous ? ((video.bytesSent - previous.bytes) * 8) / ((now - previous.time) * 1000) : null;

  const local = pair && report.get(pair.localCandidateId);
  const remote = pair && report.get(pair.remoteCandidateId);
  const relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay';

  return {
    height: video.frameHeight,
    fps: Math.round(video.framesPerSecond ?? 0),
    mbps,
    relayed,
    limit: video.qualityLimitationReason, // 'none', 'bandwidth', 'cpu' or 'other'
    rtt: pair?.currentRoundTripTime,
  };
}

const LIMIT_LABEL = {
  bandwidth: 'limitado pela internet',
  cpu: 'limitado pelo processador',
  other: 'limitado',
};

async function updateSendStats() {
  if (!outgoingStream || viewers.size === 0) {
    el.sendStats.classList.add('hidden');
    return;
  }
  const lines = [];
  let index = 0;
  for (const [id, { call }] of viewers) {
    index++;
    let stats = null;
    try {
      stats = await viewerStats(id, call);
    } catch {
      // stats not available yet
    }
    if (!stats) {
      lines.push(`#${index} conectando...`);
      continue;
    }
    const parts = [
      stats.relayed ? 'via TURN' : 'direta',
      stats.height ? `${stats.height}p` : '—',
      `${stats.fps} fps`,
    ];
    if (stats.mbps != null) parts.push(`${stats.mbps.toFixed(1).replace('.', ',')} Mbps`);
    if (stats.rtt != null) parts.push(`${Math.round(stats.rtt * 1000)} ms`);
    if (LIMIT_LABEL[stats.limit]) parts.push(`⚠ ${LIMIT_LABEL[stats.limit]}`);
    lines.push(`#${index} ${parts.join(' · ')}`);
  }
  el.sendStats.textContent = lines.join('\n');
  el.sendStats.classList.remove('hidden');
}

setInterval(updateSendStats, STATS_INTERVAL_MS);

// Admin remote control: the /admin page connects here with role "admin" and
// sends a token. We only obey after the server confirms the token.
function handleAdminConnection(conn) {
  conn.on('data', async (message) => {
    if (message?.type !== 'admin-end') return;
    let ok = false;
    try {
      const response = await fetch(
        `/api/verify?code=${code}&admin=${encodeURIComponent(String(message.token ?? ''))}`,
      );
      ok = response.ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      conn.send({ type: 'admin-denied' });
      return;
    }
    conn.send({ type: 'admin-ok' });
    endRoom('Live encerrada pelo administrador', 'O administrador do LetsWatch encerrou esta transmissão.', 'admin');
  });
}

function handleConnection(conn) {
  if (conn.metadata?.role === 'admin') {
    handleAdminConnection(conn);
    return;
  }
  conn.on('open', () => {
    if (ended) {
      conn.send({ type: 'ended' });
      return;
    }
    viewers.set(conn.peer, { conn, call: null });
    updateViewerCount();
    if (outgoingStream) callViewer(conn.peer);
  });
  conn.on('data', (message) => handleViewerMessage(conn, message));
  conn.on('close', () => removeViewer(conn.peer));
  conn.on('error', () => removeViewer(conn.peer));
}

// ---------- Audio ----------
// The sound that comes with the shared screen goes straight to viewers.
// If the screen has no sound, we send a silent track instead, so that sound
// can show up later (e.g. after "Trocar tela") without reconnecting anyone.

function getSilentTrack() {
  if (!silentTrack) {
    const context = new AudioContext();
    silentTrack = context.createMediaStreamDestination().stream.getAudioTracks()[0];
  }
  return silentTrack;
}

function outgoingAudioTrack() {
  return currentScreen?.getAudioTracks()[0] ?? getSilentTrack();
}

// Swaps the audio track for everyone with replaceTrack (no reconnection).
function updateOutgoingAudio() {
  if (!outgoingStream) return;
  const next = outgoingAudioTrack();
  const current = outgoingStream.getAudioTracks()[0];
  if (current === next) return;
  if (current) outgoingStream.removeTrack(current);
  outgoingStream.addTrack(next);
  for (const { call } of viewers.values()) {
    const sender = call?.peerConnection?.getSenders().find((s) => s.track?.kind === 'audio');
    sender?.replaceTrack(next);
  }
}

// ---------- Screen sharing ----------

async function pickScreen() {
  const preset = QUALITY_PRESETS[el.quality.value];
  const screen = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: preset.width },
      height: { ideal: preset.height },
      frameRate: { ideal: preset.fps, max: preset.fps },
      // Opens the picker on the "tab" list: sharing a tab sends ONLY that
      // tab's sound (no Discord voices, no notifications).
      displaySurface: 'browser',
    },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    // Entire screen: offers "system audio" (all PC sound, Discord included).
    // The panel shows a warning when it's in use.
    systemAudio: 'include',
    // Window (Chrome/Edge 141+ on Windows): offers ONLY the sound of the program
    // that owns the window, e.g. a game without the Discord voices. Without this
    // option the browser could offer the whole PC's sound for windows too.
    windowAudio: 'window',
    selfBrowserSurface: 'exclude', // hides this very tab from the list
    surfaceSwitching: 'include', // allows switching tabs from Chrome's sharing bar
  });
  const video = screen.getVideoTracks()[0];
  video.contentHint = preset.hint;
  // Clicking "Stop sharing" in the browser bar:
  video.addEventListener('ended', () => {
    if (currentScreen === screen) stopPresenting();
  });
  return screen;
}

function showPreview(screen) {
  el.preview.srcObject = screen ? new MediaStream(screen.getVideoTracks()) : null;
  el.previewEmpty.classList.toggle('hidden', Boolean(screen));
  el.previewLabel.classList.toggle('hidden', !screen);
  el.liveControls.classList.toggle('hidden', !screen);
  if (screen) {
    staticNoise.stop();
    el.preview.classList.remove('power-on');
    void el.preview.offsetWidth; // restarts the "TV power-on" animation
    el.preview.classList.add('power-on');
  } else {
    staticNoise.start();
  }
}

async function startPresenting() {
  let screen;
  try {
    screen = await pickScreen();
  } catch (error) {
    if (error.name !== 'NotAllowedError') {
      console.error(error);
      alert('Não foi possível compartilhar a tela neste navegador.');
    }
    return; // NotAllowedError = the person clicked Cancel
  }

  currentScreen = screen;
  outgoingStream = new MediaStream([screen.getVideoTracks()[0], outgoingAudioTrack()]);
  onAirSince = Date.now();
  idleSince = Date.now();
  pausedForIdle = false;
  showPreview(screen);
  updateNoAudioNotice();
  updateStatus();
  broadcast(currentState());
  for (const id of viewers.keys()) callViewer(id);
}

// Switches screen/window without dropping anyone: only the video track is replaced.
async function switchScreen() {
  let next;
  try {
    next = await pickScreen();
  } catch {
    return;
  }
  const previous = currentScreen;
  const newVideo = next.getVideoTracks()[0];

  currentScreen = next;
  outgoingStream.getVideoTracks().forEach((track) => outgoingStream.removeTrack(track));
  outgoingStream.addTrack(newVideo);

  for (const { call } of viewers.values()) {
    const sender = call?.peerConnection?.getSenders().find((s) => s.track?.kind === 'video');
    sender?.replaceTrack(newVideo);
  }
  updateOutgoingAudio(); // the new screen's audio (or silence if it has none)
  previous?.getTracks().forEach((track) => track.stop());
  showPreview(next);
  updateNoAudioNotice();
}

function stopPresenting() {
  currentScreen?.getTracks().forEach((track) => track.stop());
  currentScreen = null;
  outgoingStream = null;
  onAirSince = 0;
  for (const viewer of viewers.values()) {
    viewer.call?.close();
    viewer.call = null;
  }
  showPreview(null);
  updateNoAudioNotice();
  updateStatus();
  broadcast(currentState());
}

async function applyQuality() {
  const preset = QUALITY_PRESETS[el.quality.value];
  el.qualityHint.textContent = preset.label;
  if (!currentScreen) return;
  const video = currentScreen.getVideoTracks()[0];
  video.contentHint = preset.hint;
  try {
    await video.applyConstraints({
      width: { ideal: preset.width },
      height: { ideal: preset.height },
      frameRate: { ideal: preset.fps, max: preset.fps },
    });
  } catch (error) {
    console.warn(error);
  }
  for (const { call } of viewers.values()) if (call) applySendQuality(call);
}

function confirmEndLive() {
  if (!confirm('Encerrar a live para todo mundo?')) return;
  endRoom('Fim da transmissão', 'Os espectadores já foram avisados. Rebobine antes de devolver!');
}

function endRoom(title, text, reason = '') {
  stopPresenting();
  ended = true;
  broadcast({ type: 'ended', reason });
  // Give the message a moment to arrive before disconnecting.
  setTimeout(() => peer?.destroy(), 500);
  staticNoise.stop();
  showMessage(title, text);
}

// ---------- Saving resources: pause and close when nobody is watching ----------

let idleSince = Date.now();
let pausedForIdle = false;

function minutesSeconds(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function setIdleNotice(text) {
  el.idleNotice.textContent = text;
  el.idleNotice.classList.toggle('hidden', !text);
}

setInterval(() => {
  if (ended || !peer) return;
  if (viewers.size > 0) {
    idleSince = Date.now();
    pausedForIdle = false;
    setIdleNotice('');
    return;
  }

  const idleFor = Date.now() - idleSince;
  if (outgoingStream) {
    const remaining = PAUSE_WITHOUT_VIEWERS_MS - idleFor;
    if (remaining <= 0) {
      stopPresenting();
      pausedForIdle = true;
      idleSince = Date.now();
    } else if (idleFor > 60_000) {
      setIdleNotice(`Ninguém assistindo. A tela pausa sozinha em ${minutesSeconds(remaining)}.`);
      return;
    }
  }

  if (!outgoingStream) {
    const remaining = CLOSE_IDLE_ROOM_MS - (Date.now() - idleSince);
    if (remaining <= 0) {
      endRoom(
        'Sala fechada',
        'Ninguém assistiu por 30 minutos, então a sala foi fechada para não gastar recursos. Recarregue esta página para reabrir.',
      );
    } else if (remaining <= WARN_BEFORE_CLOSE_MS) {
      setIdleNotice(`Sala parada. Ela fecha sozinha em ${minutesSeconds(remaining)}.`);
    } else if (pausedForIdle) {
      setIdleNotice('A tela foi pausada porque ninguém estava assistindo. Aperte Apresentar tela para voltar.');
    } else {
      setIdleNotice('');
    }
  }
}, 1000);

// ---------- "No audio" notice ----------

// 'browser' = a tab, 'window' = an app window, 'monitor' = the entire screen
function sharedSurface() {
  return currentScreen?.getVideoTracks()[0]?.getSettings().displaySurface ?? '';
}

// Two notices under the controls:
// - no sound at all → how to turn it on;
// - entire screen WITH sound → it's the whole PC's sound, Discord voices included.
//   (Tabs and windows only send their own sound.)
function updateNoAudioNotice() {
  const hasAudio = Boolean(currentScreen?.getAudioTracks().length);
  el.noAudioNotice.classList.toggle('hidden', !currentScreen || hasAudio);
  el.systemAudioNotice.classList.toggle('hidden', !hasAudio || sharedSurface() !== 'monitor');
}

// ---------- Signaling server connection ----------

function connectPeer(config, attempt = 0) {
  peer = new Peer(presenterPeerId(code), peerOptions(config));

  peer.on('open', () => {
    showPanel();
    updateStatus();
    broadcast(currentState()); // after a reconnect, let current viewers know
  });

  peer.on('connection', handleConnection);

  // Lost the connection to the PeerJS server. Ongoing lives keep working
  // (video is direct), but new viewers can only join after reconnecting.
  peer.on('disconnected', () => {
    updateStatus();
    if (ended) return;
    setTimeout(() => {
      if (peer && !peer.destroyed && peer.disconnected) peer.reconnect();
    }, 2000);
  });

  peer.on('error', (error) => {
    console.warn('PeerJS:', error.type, error);
    if (error.type === 'unavailable-id') {
      // Another tab already has this panel open (or the previous one wasn't released yet).
      peer.destroy();
      if (attempt < 3) {
        showMessage('Conectando...', 'Liberando a sala, só um instante.', { loading: true, action: false });
        setTimeout(() => connectPeer(config, attempt + 1), 3000);
      } else {
        showMessage(
          'Este painel já está aberto',
          'A sala já está sendo apresentada em outra aba ou dispositivo. Feche a outra aba e recarregue esta página.',
        );
      }
    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(error.type)) {
      updateStatus();
    }
  });
}

// ---------- Startup ----------

async function init() {
  if (!code || !key) {
    showMessage('Link inválido', 'Este link de apresentador está incompleto. Crie uma nova live.');
    return;
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    el.presentBtn.disabled = true;
    el.supportNotice.textContent =
      'Este navegador não permite compartilhar a tela. Use Chrome, Edge ou Firefox em um computador.';
  }

  try {
    const response = await fetch(`/api/verify?code=${code}&k=${encodeURIComponent(key)}`);
    if (!response.ok) {
      showMessage('Link inválido', 'Este link de apresentador não é válido. Crie uma nova live.');
      return;
    }
  } catch {
    showMessage('Sem conexão', 'Não foi possível falar com o servidor. Verifique sua internet e recarregue.');
    return;
  }

  // "titulo" is still read so links created before the translation keep their title.
  el.title.value = params.get('title') ?? params.get('titulo') ?? '';
  el.watchLink.value = `${location.origin}/ver/${code}`;
  applyQuality();

  connectPeer(await loadConfig());
}

el.presentBtn.addEventListener('click', startPresenting);
el.switchScreen.addEventListener('click', switchScreen);
el.stop.addEventListener('click', stopPresenting);
el.endLive.addEventListener('click', confirmEndLive);
el.quality.addEventListener('change', applyQuality);
el.reactionsEnabled.addEventListener('change', () => broadcast(currentState()));
el.copyLink.addEventListener('click', () => copyText(el.watchLink.value, el.copyLink));

let titleDebounce;
el.title.addEventListener('input', () => {
  clearTimeout(titleDebounce);
  titleDebounce = setTimeout(() => broadcast(currentState()), 400);
});

window.addEventListener('beforeunload', (event) => {
  if (outgoingStream && !ended) event.preventDefault();
});

init();
