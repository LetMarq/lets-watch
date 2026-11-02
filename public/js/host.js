// Painel do apresentador.
//
// Como funciona:
// 1. Registra-se no PeerJS com o ID "letswatch-<codigo>".
// 2. Cada espectador abre uma conexão de dados com esse ID (para receber
//    título, contagem e avisos).
// 3. Quando a tela está sendo compartilhada, o apresentador "liga" (peer.call)
//    para cada espectador enviando o vídeo. O vídeo vai direto, de navegador
//    para navegador.
import { carregarConfig, codigoDaUrl, copiarTexto, idDoApresentador, opcoesDoPeer } from './common.js';
import { criarEstatica, formatarTempo } from './retro.js';

const QUALIDADES = {
  texto: { largura: 1920, altura: 1080, fps: 15, dica: 'detail', bitrate: 2_500_000, descricao: '1080p, 15 fps · slides, código, documentos' },
  fluido: { largura: 1280, altura: 720, fps: 30, dica: 'motion', bitrate: 2_500_000, descricao: '720p, 30 fps · usa menos internet' },
  video: { largura: 1920, altura: 1080, fps: 30, dica: 'motion', bitrate: 4_500_000, descricao: '1080p, 30 fps · precisa de mais upload' },
};

const $ = (id) => document.getElementById(id);
const el = {
  titulo: $('titulo'),
  status: $('status'),
  previa: $('previa'),
  previaVazia: $('previa-vazia'),
  previaRotulo: $('previa-rotulo'),
  apresentar: $('apresentar'),
  controlesAoVivo: $('controles-ao-vivo'),
  trocar: $('trocar'),
  parar: $('parar'),
  encerrar: $('encerrar'),
  microfone: $('microfone'),
  qualidade: $('qualidade'),
  qualidadeDica: $('qualidade-dica'),
  contagem: $('contagem'),
  contagemRotulo: $('contagem-rotulo'),
  linkPublico: $('link-publico'),
  copiarLink: $('copiar-link'),
  avisoSuporte: $('aviso-suporte'),
  osdEstado: $('osd-estado'),
  contador: $('contador'),
  led: $('led'),
};

// Monitor "fora do ar" enquanto ninguém está apresentando.
const estatica = criarEstatica($('estatica'));
estatica.ligar();

// Contador de fita: quanto tempo a tela está no ar.
let inicioNoAr = 0;
setInterval(() => {
  el.contador.textContent = inicioNoAr ? formatarTempo(Date.now() - inicioNoAr) : '00:00:00';
}, 500);

const codigo = codigoDaUrl();
const params = new URLSearchParams(location.search);
const chave = params.get('k');

/** @type {Map<string, {conn: any, chamada: any}>} */
const espectadores = new Map();

let peer = null;
let telaAtual = null; // MediaStream vindo do getDisplayMedia
let fluxo = null; // MediaStream enviado aos espectadores (vídeo da tela + áudio mixado)
let audio = null; // { contexto, destino, fonteTela, fonteMic, mic }
let encerrada = false;

// ---------- Telas de mensagem ----------

function mostrarMensagem(titulo, texto = '', { carregando = false, acao = true } = {}) {
  $('painel').classList.add('escondido');
  $('mensagem').classList.remove('escondido');
  $('mensagem-titulo').textContent = titulo;
  $('mensagem-texto').textContent = texto;
  $('mensagem-girando').classList.toggle('escondido', !carregando);
  $('mensagem-acao').classList.toggle('escondido', !acao);
}

function mostrarPainel() {
  $('mensagem').classList.add('escondido');
  $('painel').classList.remove('escondido');
}

function definirStatus(texto, tipo = '') {
  el.status.textContent = texto;
  el.status.className = `status ${tipo ? `status-${tipo}` : ''}`;
}

function atualizarStatus() {
  if (encerrada) return;
  if (!peer || peer.disconnected) definirStatus('Reconectando', 'alerta');
  else if (fluxo) definirStatus('● No ar', 'ao-vivo');
  else definirStatus('Pronto', 'ok');

  // letreiro dentro do monitor
  el.osdEstado.textContent = fluxo ? '● REC' : 'Standby';
  el.osdEstado.classList.toggle('rec', Boolean(fluxo));
  el.osdEstado.classList.toggle('piscar', Boolean(fluxo));
  el.led.classList.toggle('aceso', Boolean(fluxo));
}

// ---------- Comunicação com os espectadores ----------

function estadoAtual() {
  return {
    tipo: 'estado',
    titulo: el.titulo.value.trim(),
    aoVivo: Boolean(fluxo),
    espectadores: espectadores.size,
  };
}

function enviarParaTodos(mensagem) {
  for (const { conn } of espectadores.values()) {
    if (conn.open) conn.send(mensagem);
  }
}

function atualizarContagem() {
  const n = espectadores.size;
  el.contagem.textContent = String(n).padStart(2, '0');
  el.contagemRotulo.textContent = n === 1 ? 'pessoa assistindo' : 'pessoas assistindo';
  enviarParaTodos(estadoAtual());
}

function removerEspectador(id) {
  const espectador = espectadores.get(id);
  if (!espectador) return;
  espectador.chamada?.close();
  espectadores.delete(id);
  atualizarContagem();
}

function ajustarQualidadeDoEnvio(chamada) {
  const pc = chamada.peerConnection;
  if (!pc) return;
  const aplicar = async () => {
    const { bitrate } = QUALIDADES[el.qualidade.value];
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      const parametros = sender.getParameters();
      if (!parametros.encodings?.length) continue;
      parametros.encodings[0].maxBitrate = bitrate;
      try {
        await sender.setParameters(parametros);
      } catch (erro) {
        console.warn('Não foi possível ajustar a qualidade:', erro);
      }
    }
  };
  if (pc.connectionState === 'connected') aplicar();
  else pc.addEventListener('connectionstatechange', () => pc.connectionState === 'connected' && aplicar());
}

function ligarPara(id) {
  const espectador = espectadores.get(id);
  if (!espectador || !fluxo) return;
  espectador.chamada?.close();
  const chamada = peer.call(id, fluxo);
  espectador.chamada = chamada;
  ajustarQualidadeDoEnvio(chamada);
  chamada.on('error', (erro) => console.warn('Erro na chamada com', id, erro));
}

// Se o espectador perder a internet ou o computador dormir, a conexão não
// avisa que fechou. A cada poucos segundos, removemos as que caíram.
setInterval(() => {
  for (const [id, { conn }] of espectadores) {
    const estado = conn.peerConnection?.connectionState;
    if (!conn.open || estado === 'failed' || estado === 'closed') removerEspectador(id);
  }
}, 5000);

function aoConectarEspectador(conn) {
  conn.on('open', () => {
    if (encerrada) {
      conn.send({ tipo: 'encerrada' });
      return;
    }
    espectadores.set(conn.peer, { conn, chamada: null });
    atualizarContagem();
    if (fluxo) ligarPara(conn.peer);
  });
  conn.on('close', () => removerEspectador(conn.peer));
  conn.on('error', () => removerEspectador(conn.peer));
}

// ---------- Áudio: mistura o som da tela com o microfone ----------
// Sempre enviamos UMA faixa de áudio (mesmo que em silêncio). Assim dá para
// ligar e desligar o microfone sem precisar refazer as conexões.

function prepararAudio() {
  if (audio) return audio;
  const contexto = new AudioContext();
  const destino = contexto.createMediaStreamDestination();
  audio = { contexto, destino, fonteTela: null, fonteMic: null, mic: null };
  return audio;
}

function conectarAudioDaTela(tela) {
  const a = prepararAudio();
  a.fonteTela?.disconnect();
  a.fonteTela = null;
  if (tela.getAudioTracks().length) {
    a.fonteTela = a.contexto.createMediaStreamSource(new MediaStream(tela.getAudioTracks()));
    a.fonteTela.connect(a.destino);
  }
}

async function ligarMicrofone() {
  const a = prepararAudio();
  try {
    a.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (erro) {
    console.warn(erro);
    el.microfone.checked = false;
    alert('Não foi possível usar o microfone. Verifique a permissão do navegador.');
    return;
  }
  a.fonteMic = a.contexto.createMediaStreamSource(a.mic);
  a.fonteMic.connect(a.destino);
}

function desligarMicrofone() {
  if (!audio) return;
  audio.fonteMic?.disconnect();
  audio.mic?.getTracks().forEach((t) => t.stop());
  audio.fonteMic = null;
  audio.mic = null;
}

// ---------- Compartilhamento de tela ----------

async function escolherTela() {
  const q = QUALIDADES[el.qualidade.value];
  const tela = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: q.largura },
      height: { ideal: q.altura },
      frameRate: { ideal: q.fps, max: q.fps },
    },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'include', // oferece "som do sistema" ao compartilhar a tela inteira
    selfBrowserSurface: 'exclude', // esconde esta própria aba da lista
    surfaceSwitching: 'include', // permite trocar de guia pela barra do Chrome
  });
  const video = tela.getVideoTracks()[0];
  video.contentHint = q.dica;
  // Clicar em "Parar compartilhamento" na barra do navegador:
  video.addEventListener('ended', () => {
    if (telaAtual === tela) pararApresentacao();
  });
  return tela;
}

function mostrarPrevia(tela) {
  el.previa.srcObject = tela ? new MediaStream(tela.getVideoTracks()) : null;
  el.previaVazia.classList.toggle('escondido', Boolean(tela));
  el.previaRotulo.classList.toggle('escondido', !tela);
  el.controlesAoVivo.classList.toggle('escondido', !tela);
  if (tela) {
    estatica.desligar();
    el.previa.classList.remove('ligando');
    void el.previa.offsetWidth; // reinicia a animação de "ligar a TV"
    el.previa.classList.add('ligando');
  } else {
    estatica.ligar();
  }
}

async function apresentar() {
  prepararAudio();
  await audio.contexto.resume();

  let tela;
  try {
    tela = await escolherTela();
  } catch (erro) {
    if (erro.name !== 'NotAllowedError') {
      console.error(erro);
      alert('Não foi possível compartilhar a tela neste navegador.');
    }
    return; // NotAllowedError = a pessoa clicou em Cancelar
  }

  telaAtual = tela;
  conectarAudioDaTela(tela);
  fluxo = new MediaStream([tela.getVideoTracks()[0], audio.destino.stream.getAudioTracks()[0]]);
  inicioNoAr = Date.now();
  mostrarPrevia(tela);
  atualizarStatus();
  enviarParaTodos(estadoAtual());
  for (const id of espectadores.keys()) ligarPara(id);
}

// Troca a tela/janela sem derrubar ninguém: substitui só a faixa de vídeo.
async function trocarTela() {
  let nova;
  try {
    nova = await escolherTela();
  } catch {
    return;
  }
  const antiga = telaAtual;
  const videoNovo = nova.getVideoTracks()[0];

  telaAtual = nova;
  conectarAudioDaTela(nova);
  fluxo.getVideoTracks().forEach((t) => fluxo.removeTrack(t));
  fluxo.addTrack(videoNovo);

  for (const { chamada } of espectadores.values()) {
    const sender = chamada?.peerConnection?.getSenders().find((s) => s.track?.kind === 'video');
    sender?.replaceTrack(videoNovo);
  }
  antiga?.getTracks().forEach((t) => t.stop());
  mostrarPrevia(nova);
}

function pararApresentacao() {
  telaAtual?.getTracks().forEach((t) => t.stop());
  telaAtual = null;
  fluxo = null;
  inicioNoAr = 0;
  if (audio) {
    audio.fonteTela?.disconnect();
    audio.fonteTela = null;
  }
  for (const espectador of espectadores.values()) {
    espectador.chamada?.close();
    espectador.chamada = null;
  }
  mostrarPrevia(null);
  atualizarStatus();
  enviarParaTodos(estadoAtual());
}

async function aplicarQualidade() {
  const q = QUALIDADES[el.qualidade.value];
  el.qualidadeDica.textContent = q.descricao;
  if (!telaAtual) return;
  const video = telaAtual.getVideoTracks()[0];
  video.contentHint = q.dica;
  try {
    await video.applyConstraints({
      width: { ideal: q.largura },
      height: { ideal: q.altura },
      frameRate: { ideal: q.fps, max: q.fps },
    });
  } catch (erro) {
    console.warn(erro);
  }
  for (const { chamada } of espectadores.values()) if (chamada) ajustarQualidadeDoEnvio(chamada);
}

function encerrarLive() {
  if (!confirm('Encerrar a live para todo mundo?')) return;
  pararApresentacao();
  desligarMicrofone();
  encerrada = true;
  enviarParaTodos({ tipo: 'encerrada' });
  // Dá um instante para a mensagem chegar antes de desconectar.
  setTimeout(() => peer?.destroy(), 500);
  estatica.desligar();
  mostrarMensagem('Fim da transmissão', 'Os espectadores já foram avisados. Rebobine antes de devolver!');
}

// ---------- Conexão com o servidor de sinalização ----------

function conectarPeer(config, tentativa = 0) {
  peer = new Peer(idDoApresentador(codigo), opcoesDoPeer(config));

  peer.on('open', () => {
    mostrarPainel();
    atualizarStatus();
  });

  peer.on('connection', aoConectarEspectador);

  // Caiu a conexão com o servidor do PeerJS. As lives em andamento continuam
  // (o vídeo é direto), mas novos espectadores só entram depois de reconectar.
  peer.on('disconnected', () => {
    atualizarStatus();
    if (encerrada) return;
    setTimeout(() => {
      if (peer && !peer.destroyed && peer.disconnected) peer.reconnect();
    }, 2000);
  });

  peer.on('error', (erro) => {
    console.warn('PeerJS:', erro.type, erro);
    if (erro.type === 'unavailable-id') {
      // Outra aba já está com este painel aberto (ou a anterior ainda não foi liberada).
      peer.destroy();
      if (tentativa < 3) {
        mostrarMensagem('Conectando...', 'Liberando a sala, só um instante.', { carregando: true, acao: false });
        setTimeout(() => conectarPeer(config, tentativa + 1), 3000);
      } else {
        mostrarMensagem(
          'Este painel já está aberto',
          'A sala já está sendo apresentada em outra aba ou dispositivo. Feche a outra aba e recarregue esta página.',
        );
      }
    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(erro.type)) {
      atualizarStatus();
    }
  });

  peer.on('open', () => {
    // Reconectou: avisa quem já estava assistindo.
    enviarParaTodos(estadoAtual());
  });
}

// ---------- Início ----------

async function iniciar() {
  if (!codigo || !chave) {
    mostrarMensagem('Link inválido', 'Este link de apresentador está incompleto. Crie uma nova live.');
    return;
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    el.apresentar.disabled = true;
    el.avisoSuporte.textContent =
      'Este navegador não permite compartilhar a tela. Use Chrome, Edge ou Firefox em um computador.';
  }

  try {
    const resposta = await fetch(`/api/verificar?codigo=${codigo}&k=${encodeURIComponent(chave)}`);
    if (!resposta.ok) {
      mostrarMensagem('Link inválido', 'Este link de apresentador não é válido. Crie uma nova live.');
      return;
    }
  } catch {
    mostrarMensagem('Sem conexão', 'Não foi possível falar com o servidor. Verifique sua internet e recarregue.');
    return;
  }

  el.titulo.value = params.get('titulo') ?? '';
  el.linkPublico.value = `${location.origin}/ver/${codigo}`;
  aplicarQualidade();

  const config = await carregarConfig();
  conectarPeer(config);
}

el.apresentar.addEventListener('click', apresentar);
el.trocar.addEventListener('click', trocarTela);
el.parar.addEventListener('click', pararApresentacao);
el.encerrar.addEventListener('click', encerrarLive);
el.qualidade.addEventListener('change', aplicarQualidade);
el.copiarLink.addEventListener('click', () => copiarTexto(el.linkPublico.value, el.copiarLink));
el.microfone.addEventListener('change', () => {
  if (el.microfone.checked) ligarMicrofone();
  else desligarMicrofone();
});

let esperaTitulo;
el.titulo.addEventListener('input', () => {
  clearTimeout(esperaTitulo);
  esperaTitulo = setTimeout(() => enviarParaTodos(estadoAtual()), 400);
});

window.addEventListener('beforeunload', (evento) => {
  if (fluxo && !encerrada) evento.preventDefault();
});

iniciar();
