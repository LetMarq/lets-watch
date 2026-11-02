// Código compartilhado entre o painel do apresentador e a página de assistir.

// O apresentador se registra no PeerJS com o ID "letswatch-<codigo>".
// Os espectadores sabem o código pelo link, então sabem para quem ligar.
export const PREFIXO_PEER = 'letswatch-';

export function idDoApresentador(codigo) {
  return PREFIXO_PEER + codigo;
}

export function codigoDaUrl() {
  const encontrado = location.pathname.match(/^\/(?:ver|transmitir)\/([A-Za-z0-9]{8})\/?$/);
  return encontrado ? encontrado[1] : null;
}

// Busca no backend quais servidores STUN/TURN e PeerJS usar.
export async function carregarConfig() {
  try {
    const resposta = await fetch('/api/config');
    if (resposta.ok) return await resposta.json();
  } catch {
    // sem backend (ex.: abrindo o HTML direto): usa o padrão
  }
  return { peer: null, iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
}

export function opcoesDoPeer(config) {
  return {
    ...(config.peer ?? {}),
    config: { iceServers: config.iceServers },
    debug: 1, // 0 = nada, 3 = tudo. Aumente para investigar problemas no console.
  };
}

export async function copiarTexto(texto, botao) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const campo = document.createElement('textarea');
    campo.value = texto;
    document.body.append(campo);
    campo.select();
    document.execCommand('copy');
    campo.remove();
  }
  if (botao) {
    const original = botao.textContent;
    botao.textContent = 'Copiado!';
    setTimeout(() => (botao.textContent = original), 1500);
  }
}

export function plural(n, singular, pluralTexto) {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}
