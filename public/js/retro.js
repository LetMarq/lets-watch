// Efeitos retrô: a "estática" de TV fora do ar, desenhada num <canvas>.
// O canvas é pequeno e o CSS estica, o que deixa o chuvisco mais granulado
// e gasta pouquíssimo processamento.

const reduzirMovimento = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function criarEstatica(canvas, { largura = 160, altura = 120, fps = 20 } = {}) {
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext('2d');
  const imagem = ctx.createImageData(largura, altura);
  const pixels = new Uint32Array(imagem.data.buffer);
  const intervalo = 1000 / fps;
  let ligada = false;
  let quadro = 0;
  let ultimo = 0;

  function desenhar() {
    for (let i = 0; i < pixels.length; i++) {
      const v = (Math.random() * 255) | 0;
      pixels[i] = 0xff000000 | (v << 16) | (v << 8) | v; // cinza opaco
    }
    ctx.putImageData(imagem, 0, 0);
  }

  function animar(agora) {
    if (!ligada) return;
    quadro = requestAnimationFrame(animar);
    if (agora - ultimo < intervalo) return;
    ultimo = agora;
    desenhar();
  }

  return {
    ligar() {
      if (ligada) return;
      ligada = true;
      desenhar();
      if (!reduzirMovimento) quadro = requestAnimationFrame(animar);
    },
    desligar() {
      ligada = false;
      cancelAnimationFrame(quadro);
    },
  };
}

// "00:12:34" — contador de fita
export function formatarTempo(ms) {
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
