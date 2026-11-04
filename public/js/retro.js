// Retro effects: the "no signal" TV static, drawn on a <canvas>.
// The canvas is small and CSS stretches it, which makes the noise grainier
// and costs very little processing.

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createStatic(canvas, { width = 160, height = 120, fps = 20 } = {}) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const pixels = new Uint32Array(image.data.buffer);
  const interval = 1000 / fps;
  let running = false;
  let frame = 0;
  let last = 0;

  function draw() {
    for (let i = 0; i < pixels.length; i++) {
      const v = (Math.random() * 255) | 0;
      pixels[i] = 0xff000000 | (v << 16) | (v << 8) | v; // opaque gray
    }
    ctx.putImageData(image, 0, 0);
  }

  function animate(now) {
    if (!running) return;
    frame = requestAnimationFrame(animate);
    if (now - last < interval) return;
    last = now;
    draw();
  }

  return {
    start() {
      if (running) return;
      running = true;
      draw();
      if (!reduceMotion) frame = requestAnimationFrame(animate);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frame);
    },
  };
}

// "00:12:34": tape counter
export function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
