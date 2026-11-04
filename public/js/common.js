// Code shared by the presenter panel and the watch page.

// The presenter registers on PeerJS with the id "letswatch-<code>".
// Viewers know the code from the link, so they know who to call.
export const PEER_PREFIX = 'letswatch-';

export function presenterPeerId(code) {
  return PEER_PREFIX + code;
}

// Room links keep their Portuguese paths: /ver/<code> and /transmitir/<code>.
export function codeFromUrl() {
  const match = location.pathname.match(/^\/(?:ver|transmitir)\/([A-Za-z0-9]{8})\/?$/);
  return match ? match[1] : null;
}

// ---------- TURN saved in this browser (/turn page) ----------
// Anyone can save their own TURN (e.g. their own free ExpressTURN account).
// It is stored only in this browser (localStorage) and goes FIRST in the
// list: Chrome gives more priority to the TURN servers at the top. The site's
// servers stay in the list as a fallback, in case the personal one stops working.

const TURN_STORAGE_KEY = 'letswatch-turn';

export function browserTurns() {
  try {
    const saved = JSON.parse(localStorage.getItem(TURN_STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export function saveBrowserTurns(list) {
  try {
    localStorage.setItem(TURN_STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false; // private window or blocked storage
  }
}

// Asks the backend which STUN/TURN and PeerJS servers to use,
// and adds the TURN saved in this browser, if any.
export async function loadConfig() {
  let config = { peer: null, iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], hasTurn: false };
  try {
    const response = await fetch('/api/config');
    if (response.ok) config = await response.json();
  } catch {
    // no backend (e.g. opening the HTML file directly): use the default
  }
  const own = browserTurns();
  if (own.length) {
    config.iceServers = [...own, ...config.iceServers];
    config.hasTurn = true;
  }
  return config;
}

export function peerOptions(config) {
  return {
    ...(config.peer ?? {}),
    config: { iceServers: config.iceServers },
    debug: 1, // 0 = nothing, 3 = everything. Raise it to debug problems in the console.
  };
}

export async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    document.body.append(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
  if (button) {
    const original = button.textContent;
    button.textContent = 'Copiado!';
    setTimeout(() => (button.textContent = original), 1500);
  }
}

// ---------- Reactions (emojis) ----------
// Only these emojis are accepted: the presenter ignores anything else.
export const REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🔥', '🎉', '😢'];

// Launches an emoji that floats up inside "layer" and disappears by itself.
export function launchEmoji(layer, emoji) {
  if (!layer || !REACTIONS.includes(emoji)) return;
  const el = document.createElement('span');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.style.left = `${62 + Math.random() * 30}%`;
  el.style.setProperty('--drift', `${Math.round(Math.random() * 80 - 40)}px`);
  el.addEventListener('animationend', () => el.remove());
  layer.append(el);
}

export function plural(n, singular, pluralForm) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}
