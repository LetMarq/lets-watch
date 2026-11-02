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

// ---------- TURN cadastrado neste navegador (página /turn) ----------
// Cada pessoa pode cadastrar um TURN próprio (ex.: uma conta grátis dela na
// ExpressTURN). Ele fica salvo só neste navegador (localStorage) e vai PRIMEIRO
// na lista: o Chrome dá mais prioridade aos TURNs do começo da lista. Os do
// site continuam na lista como reserva, caso o da pessoa pare de funcionar.

const CHAVE_TURN = 'letswatch-turn';

export function turnsDoNavegador() {
  try {
    const salvos = JSON.parse(localStorage.getItem(CHAVE_TURN) || '[]');
    return Array.isArray(salvos) ? salvos : [];
  } catch {
    return [];
  }
}

export function salvarTurnsDoNavegador(lista) {
  try {
    localStorage.setItem(CHAVE_TURN, JSON.stringify(lista));
    return true;
  } catch {
    return false; // navegação anônima ou armazenamento bloqueado
  }
}

// Busca no backend quais servidores STUN/TURN e PeerJS usar
// e junta com o TURN cadastrado neste navegador, se houver.
export async function carregarConfig() {
  let config = { peer: null, iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], temTurn: false };
  try {
    const resposta = await fetch('/api/config');
    if (resposta.ok) config = await resposta.json();
  } catch {
    // sem backend (ex.: abrindo o HTML direto): usa o padrão
  }
  const meus = turnsDoNavegador();
  if (meus.length) {
    config.iceServers = [...meus, ...config.iceServers];
    config.temTurn = true;
  }
  return config;
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
