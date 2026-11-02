// Página de quem assiste.
//
// 1. Conecta no servidor do PeerJS com um ID aleatório.
// 2. Abre uma conexão de dados com o apresentador ("letswatch-<codigo>").
//    Se ele ainda não chegou, tenta de novo a cada poucos segundos.
// 3. Quando o apresentador compartilha a tela, ele liga para cá e o vídeo
//    aparece no <video>.
import { carregarConfig, codigoDaUrl, idDoApresentador, opcoesDoPeer, plural } from './common.js';
import { criarEstatica } from './retro.js';

const INTERVALO_TENTATIVA = 3000;
const CHAVE_CRT = 'letswatch-crt';

const $ = (id) => document.getElementById(id);
const el = {
  palco: $('palco'),
  video: $('video'),
  aviso: $('aviso'),
  avisoCamada: $('aviso-camada'),
  avisoTitulo: $('aviso-titulo'),
  avisoTexto: $('aviso-texto'),
  avisoLink: $('aviso-link'),
  estaticaCanvas: $('estatica'),
  estaticaBarra: $('estatica-barra'),
  titulo: $('titulo'),
  osdPlay: $('osd-play'),
  seloAoVivo: $('selo-ao-vivo'),
  espectadores: $('espectadores'),
  ativarSom: $('ativar-som'),
  botaoSom: $('botao-som'),
  iconeMudo: $('icone-mudo'),
  iconeSom: $('icone-som'),
  botaoCrt: $('botao-crt'),
  botaoPreencher: $('botao-preencher'),
  botaoPip: $('botao-pip'),
  botaoTelaCheia: $('botao-tela-cheia'),
};

const codigo = codigoDaUrl();
const idApresentador = codigo && idDoApresentador(codigo);
const estatica = criarEstatica(el.estaticaCanvas);

let peer = null;
let conexao = null;
let chamada = null;
let tentativa = null;
let encerrada = false;
let temTurn = false;

// ---------- Telas de espera ----------
// 'estatica' = TV fora do ar (sem sinal / sintonizando)
// 'azul'     = tela azul de videocassete (pausa, fim da fita, erro)

function mostrarAviso(titulo, texto = '', tipo = 'estatica') {
  el.aviso.classList.remove('escondido');
  el.avisoTitulo.textContent = titulo;
  el.avisoTexto.textContent = texto;
  el.avisoLink.classList.add('escondido');

  const azul = tipo === 'azul';
  el.avisoCamada.classList.toggle('tela-azul', azul);
  el.estaticaCanvas.classList.toggle('escondido', azul);
  el.estaticaBarra.classList.toggle('escondido', azul);
  if (azul) estatica.desligar();
  else estatica.ligar();
}

function esconderAviso() {
  el.aviso.classList.add('escondido');
  estatica.desligar();
}

function definirAoVivo(aoVivo) {
  el.seloAoVivo.classList.toggle('escondido', !aoVivo);
}

// ---------- Conexão com o apresentador ----------

function agendarNovaTentativa() {
  if (encerrada || tentativa) return;
  tentativa = setTimeout(() => {
    tentativa = null;
    conectarAoApresentador();
  }, INTERVALO_TENTATIVA);
}

function aguardandoApresentador() {
  definirAoVivo(false);
  mostrarAviso('Sem sinal', 'Aguardando o apresentador. Pode deixar esta página aberta.');
}

function conectarAoApresentador() {
  if (encerrada || !peer || peer.disconnected || peer.destroyed) return;
  conexao?.close();
  const conn = peer.connect(idApresentador, { reliable: true });
  conexao = conn;

  // Se não abrir em alguns segundos, o apresentador existe mas a rede
  // bloqueou a conexão direta. Avisa e tenta de novo.
  const limite = setTimeout(() => {
    if (!conn.open && conexao === conn) {
      conn.close();
      if (!el.video.srcObject) {
        mostrarAviso(
          'Sem conexão direta',
          temTurn
            ? 'A rede bloqueou a conexão com o apresentador. Tentando de novo... Se continuar, cadastre um TURN seu.'
            : 'A rede bloqueou a conexão com o apresentador. Cadastre um TURN seu para resolver.',
          'azul',
        );
        el.avisoLink.classList.remove('escondido');
      }
      agendarNovaTentativa();
    }
  }, 12000);

  conn.on('open', () => clearTimeout(limite));
  conn.on('data', tratarMensagem);
  conn.on('close', () => {
    clearTimeout(limite);
    if (conexao !== conn || encerrada) return;
    conexao = null;
    pararVideo();
    aguardandoApresentador();
    agendarNovaTentativa();
  });
}

function tratarMensagem(mensagem) {
  if (encerrada) return;
  if (mensagem?.tipo === 'encerrada') {
    encerrar(mensagem.motivo);
    return;
  }
  if (mensagem?.tipo !== 'estado') return;

  const titulo = mensagem.titulo || 'Live no LetsWatch';
  el.titulo.textContent = titulo;
  document.title = `${titulo} · LetsWatch`;
  el.espectadores.textContent = plural(mensagem.espectadores, 'pessoa', 'pessoas');
  definirAoVivo(mensagem.aoVivo);

  if (!mensagem.aoVivo) {
    pararVideo();
    mostrarAviso('❚❚ Pausa', 'O apresentador está na sala. A tela aparece assim que ele apertar play.', 'azul');
  } else if (!el.video.srcObject) {
    mostrarAviso('Sintonizando...', 'Carregando a tela');
  }
}

function receberChamada(novaChamada) {
  // Só aceitamos vídeo vindo do apresentador desta sala.
  if (novaChamada.peer !== idApresentador) {
    novaChamada.close();
    return;
  }
  chamada?.close();
  chamada = novaChamada;
  novaChamada.answer(); // só recebemos; não enviamos nada
  novaChamada.on('stream', (fluxo) => {
    if (chamada !== novaChamada) return;
    el.video.srcObject = fluxo;
    tocar();
  });
  novaChamada.on('close', () => {
    if (chamada === novaChamada) pararVideo();
  });
}

function pararVideo() {
  chamada?.close();
  chamada = null;
  el.video.srcObject = null;
  el.osdPlay.classList.add('escondido');
  el.ativarSom.classList.add('escondido');
}

function encerrar(motivo = '') {
  encerrada = true;
  clearTimeout(tentativa);
  pararVideo();
  definirAoVivo(false);
  el.espectadores.textContent = '';
  if (motivo === 'admin') {
    mostrarAviso('■ Fim da fita', 'A live foi encerrada pelo administrador.', 'azul');
  } else {
    mostrarAviso('■ Fim da fita', 'A live terminou. Obrigada por assistir!', 'azul');
  }
  setTimeout(() => peer?.destroy(), 300);
}

// ---------- Vídeo e som ----------
// Os navegadores só deixam tocar com som depois de um clique na página.
// Por isso começamos mudo e mostramos o botão "Ativar som".

async function tocar() {
  try {
    await el.video.play();
  } catch {
    // ainda sem permissão para tocar; o botão de som resolve
  }
  esconderAviso();
  el.osdPlay.classList.remove('escondido');
  // efeito de "ligar a TV"
  el.video.classList.remove('ligando');
  void el.video.offsetWidth;
  el.video.classList.add('ligando');
  atualizarSom();
}

function atualizarSom() {
  const mudo = el.video.muted;
  el.iconeMudo.classList.toggle('escondido', !mudo);
  el.iconeSom.classList.toggle('escondido', mudo);
  el.ativarSom.classList.toggle('escondido', !mudo || !el.video.srcObject);
}

function alternarSom() {
  el.video.muted = !el.video.muted;
  el.video.play().catch(() => {});
  atualizarSom();
}

function alternarTelaCheia() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
    return;
  }
  // Em tela cheia os controles somem, então já liga o som aqui
  // (o clique conta como permissão do navegador para tocar com som).
  if (el.video.muted && el.video.srcObject) {
    el.video.muted = false;
    el.video.play().catch(() => {});
    atualizarSom();
  }
  if (el.palco.requestFullscreen) {
    el.palco.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  } else if (el.video.webkitEnterFullscreen) {
    el.video.webkitEnterFullscreen(); // iPhone
  }
}

// Em tela cheia, esconde tudo e mostra só a tela. Para sair: Esc, F ou dois cliques.
document.addEventListener('fullscreenchange', () => {
  el.palco.classList.toggle('tela-cheia', Boolean(document.fullscreenElement));
});

async function alternarPip() {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await el.video.requestPictureInPicture();
  } catch (erro) {
    console.warn(erro);
  }
}

function alternarPreencher() {
  const ativo = el.palco.classList.toggle('preencher');
  el.botaoPreencher.classList.toggle('ativo', ativo);
}

// Efeito de TV de tubo (scanlines e cantos escuros). Fica salvo neste navegador.
function definirCrt(ativo) {
  el.palco.classList.toggle('crt', ativo);
  el.botaoCrt.classList.toggle('ativo', ativo);
  el.botaoCrt.setAttribute('aria-pressed', String(ativo));
  try {
    localStorage.setItem(CHAVE_CRT, ativo ? '1' : '0');
  } catch {
    // navegação anônima ou armazenamento bloqueado: tudo bem
  }
}

function crtSalvo() {
  try {
    return localStorage.getItem(CHAVE_CRT) !== '0';
  } catch {
    return true;
  }
}

// Esconde os controles depois de alguns segundos sem mexer o mouse.
let ocioso;
function mostrarControles() {
  el.palco.classList.remove('ocioso');
  clearTimeout(ocioso);
  ocioso = setTimeout(() => {
    if (el.video.srcObject) el.palco.classList.add('ocioso');
  }, 3000);
}

// ---------- Início ----------

async function iniciar() {
  definirCrt(crtSalvo());

  if (!codigo) {
    mostrarAviso('Erro de leitura', 'Link inválido. Confira se ele foi copiado inteiro.', 'azul');
    return;
  }

  mostrarAviso('Sintonizando...');
  const config = await carregarConfig();
  temTurn = Boolean(config.temTurn);
  peer = new Peer(opcoesDoPeer(config));

  peer.on('open', () => conectarAoApresentador());
  peer.on('call', receberChamada);

  peer.on('disconnected', () => {
    if (encerrada) return;
    setTimeout(() => {
      if (!peer.destroyed && peer.disconnected) peer.reconnect();
    }, 2000);
  });

  peer.on('error', (erro) => {
    if (erro.type === 'peer-unavailable') {
      // O apresentador ainda não abriu o painel (ou saiu).
      if (!el.video.srcObject) aguardandoApresentador();
      agendarNovaTentativa();
    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(erro.type)) {
      if (!el.video.srcObject) mostrarAviso('Reconectando...', 'Verificando sua conexão com a internet.');
    } else {
      console.warn('PeerJS:', erro.type, erro);
    }
  });
}

el.ativarSom.addEventListener('click', alternarSom);
el.botaoSom.addEventListener('click', alternarSom);
el.botaoTelaCheia.addEventListener('click', alternarTelaCheia);
el.botaoPreencher.addEventListener('click', alternarPreencher);
el.botaoCrt.addEventListener('click', () => definirCrt(!el.palco.classList.contains('crt')));
el.video.addEventListener('dblclick', alternarTelaCheia);

if (document.pictureInPictureEnabled) el.botaoPip.addEventListener('click', alternarPip);
else el.botaoPip.classList.add('escondido');

// Ao fechar a aba, desconecta na hora para a contagem do apresentador atualizar.
window.addEventListener('pagehide', () => peer?.destroy());

document.addEventListener('pointermove', mostrarControles);
document.addEventListener('keydown', (evento) => {
  if (evento.target.closest('input, textarea')) return;
  if (evento.key === 'f' || evento.key === 'F') alternarTelaCheia();
  if (evento.key === 'm' || evento.key === 'M') alternarSom();
  mostrarControles();
});

iniciar();
