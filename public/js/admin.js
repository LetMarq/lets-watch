// Página /admin: encerra a live de qualquer sala aberta.
//
// 1. Confere a senha no servidor (/api/admin) e recebe um token para a sala.
// 2. Conecta ao painel do apresentador pelo PeerJS, com o papel "admin".
// 3. Envia o comando com o token. O painel confere o token e encerra a live.
import { carregarConfig, idDoApresentador, opcoesDoPeer } from './common.js';

const LIMITE = 15000;

const form = document.getElementById('form-admin');
const campoSenha = document.getElementById('senha');
const campoSala = document.getElementById('sala');
const botao = document.getElementById('botao-encerrar');
const visor = document.getElementById('visor');

let config = null;

function mostrar(texto, tipo = '') {
  visor.textContent = texto;
  visor.dataset.tipo = tipo; // '', 'ok' ou 'erro'
}

// Aceita o link de assistir, o link do painel ou só o código.
function extrairCodigo(texto) {
  const limpo = texto.trim();
  const doLink = limpo.match(/\/(?:ver|transmitir)\/([A-Za-z0-9]{8})(?:[/?#]|$)/);
  if (doLink) return doLink[1];
  return /^[A-Za-z0-9]{8}$/.test(limpo) ? limpo : null;
}

async function pedirToken(senha, codigo) {
  const resposta = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ senha, codigo }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro || `Erro ${resposta.status}`);
  return dados.token;
}

// Conecta ao painel e envia o comando. Resolve com uma mensagem de sucesso.
function enviarComando(codigo, token) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(opcoesDoPeer(config));
    let terminou = false;

    const acabar = (erro, mensagem) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(limite);
      setTimeout(() => peer.destroy(), 300);
      if (erro) reject(new Error(erro));
      else resolve(mensagem);
    };

    const limite = setTimeout(
      () => acabar('Não deu para falar com o painel do apresentador. Tente de novo em instantes.'),
      LIMITE,
    );

    peer.on('error', (erro) => {
      if (erro.type === 'peer-unavailable') {
        acabar('Essa live não está aberta agora: o painel do apresentador está fechado ou a live já terminou.');
      } else {
        acabar(`Erro de conexão (${erro.type}).`);
      }
    });

    peer.on('open', () => {
      const conn = peer.connect(idDoApresentador(codigo), { reliable: true, metadata: { papel: 'admin' } });
      conn.on('open', () => conn.send({ tipo: 'admin-encerrar', token }));
      conn.on('data', (mensagem) => {
        if (mensagem?.tipo === 'admin-ok') acabar(null, `Live ${codigo} encerrada.`);
        if (mensagem?.tipo === 'admin-negado') acabar('O painel recusou o comando (token inválido).');
      });
    });
  });
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const codigo = extrairCodigo(campoSala.value);
  if (!codigo) {
    mostrar('Link ou código inválido', 'erro');
    return;
  }

  botao.disabled = true;
  try {
    mostrar('Conferindo senha...');
    const token = await pedirToken(campoSenha.value, codigo);
    mostrar('Conectando à live...');
    config ??= await carregarConfig();
    mostrar(await enviarComando(codigo, token), 'ok');
    campoSala.value = '';
  } catch (erro) {
    mostrar(erro.message, 'erro');
  } finally {
    botao.disabled = false;
  }
});
