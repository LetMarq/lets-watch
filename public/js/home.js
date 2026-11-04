// Home page: "records a tape" (creates a room) and shows the links.
import { copyText } from './common.js';
import { createStatic } from './retro.js';

const $ = (id) => document.getElementById(id);
const form = $('create-form');
const createBtn = form.querySelector('button[type="submit"]');
const createBtnText = createBtn.textContent;
const tape = $('tape');

// The home page TV stays "off the air" until the room is created.
const staticNoise = createStatic($('static'));
staticNoise.start();

function showTvReady() {
  staticNoise.stop();
  $('static').classList.add('hidden');
  $('static-bar').classList.add('hidden');
  $('tv-no-signal').classList.add('hidden');
  const ready = $('tv-ready');
  ready.classList.remove('hidden');
  ready.classList.add('power-on');
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  createBtn.disabled = true;
  createBtn.textContent = '● Gravando...';
  tape.classList.add('recording');

  try {
    const [response] = await Promise.all([
      fetch('/api/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: $('title-input').value }),
      }),
      wait(900), // time to see the reels spinning
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const room = await response.json();

    $('sticker-title').textContent = room.title || 'Live sem título';
    $('sticker-code').textContent = `FITA ${room.code}`;
    $('watch-link').value = room.watchLink;
    $('presenter-link').value = room.presenterLink;
    $('open-panel').href = room.presenterLink;
    $('create-section').classList.add('hidden');
    $('result-section').classList.remove('hidden');
    showTvReady();
  } catch (error) {
    console.error(error);
    alert('Não foi possível criar a sala. Tente de novo.');
  } finally {
    tape.classList.remove('recording');
    createBtn.disabled = false;
    createBtn.textContent = createBtnText;
  }
});

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', () => copyText($(button.dataset.copy).value, button));
});
