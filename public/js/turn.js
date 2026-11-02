// Página /turn: cada pessoa cadastra um TURN próprio neste navegador.
// Ele fica no localStorage e é colocado PRIMEIRO na lista de servidores
// (veja carregarConfig em common.js). O Chrome dá mais prioridade aos TURNs
// que vêm antes na lista; o do site fica de reserva.
import { salvarTurnsDoNavegador, turnsDoNavegador } from './common.js';

const LIMITE_TESTE = 8000;

const $ = (id) => document.getElementById(id);
const visor = $('visor');
const form = $('form-turn');
const botaoSalvar = $('salvar');

function mostrar(texto, tipo = '') {
  visor.textContent = texto;
  visor.dataset.tipo = tipo;
}

// "turn:free.expressturn.com:3478" ou "free.expressturn.com" → "free.expressturn.com:3478"
function limparEndereco(texto) {
  let endereco = texto.trim().replace(/^turns?:/i, '').replace(/\?.*$/, '').replace(/\/+$/, '');
  if (!/:\d+$/.test(endereco)) endereco += ':3478';
  return endereco;
}

function montarServidor(endereco, usuario, senha) {
  return {
    urls: [`turn:${endereco}`, `turn:${endereco}?transport=tcp`],
    username: usuario.trim(),
    credential: senha.trim(),
  };
}

// Testa o TURN de verdade: pede ao navegador um caminho SÓ pelo TURN ("relay").
// Se aparecer um candidato do tipo relay, usuário, senha e cota estão ok.
async function testar(servidor) {
  const pc = new RTCPeerConnection({ iceServers: [servidor], iceTransportPolicy: 'relay' });
  try {
    pc.createDataChannel('teste');
    const resultado = new Promise((resolve) => {
      const limite = setTimeout(() => resolve(false), LIMITE_TESTE);
      pc.addEventListener('icecandidate', (evento) => {
        if (evento.candidate && / typ relay /.test(evento.candidate.candidate)) {
          clearTimeout(limite);
          resolve(true);
        } else if (!evento.candidate) {
          clearTimeout(limite);
          resolve(false); // terminou de procurar sem achar caminho pelo TURN
        }
      });
    });
    await pc.setLocalDescription(await pc.createOffer());
    return await resultado;
  } catch {
    return false;
  } finally {
    pc.close();
  }
}

function atualizarTela() {
  const [salvo] = turnsDoNavegador();
  $('salvo').classList.toggle('escondido', !salvo);
  $('titulo-form').textContent = salvo ? 'Trocar por outro TURN' : 'Cadastrar um TURN';
  if (salvo) {
    $('salvo-servidor').textContent = String(salvo.urls?.[0] ?? '').replace(/^turn:/, '');
    $('salvo-usuario').textContent = `usuário ${salvo.username}`;
    mostrar('Usando o SEU TURN primeiro', 'ok');
  } else {
    mostrar('Usando o TURN do site');
  }
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const servidor = montarServidor(limparEndereco($('servidor').value), $('usuario').value, $('senha').value);

  botaoSalvar.disabled = true;
  mostrar('Testando...');
  const funciona = await testar(servidor);
  botaoSalvar.disabled = false;

  if (!funciona) {
    mostrar('Não funcionou. Confira usuário e senha (ou a cota acabou).', 'erro');
    return;
  }
  if (!salvarTurnsDoNavegador([servidor])) {
    mostrar('Funciona, mas este navegador não deixou salvar (janela anônima?).', 'erro');
    return;
  }
  form.reset();
  atualizarTela();
  mostrar('Funcionando! Salvo neste navegador.', 'ok');
});

$('testar-salvo').addEventListener('click', async () => {
  const [salvo] = turnsDoNavegador();
  if (!salvo) return;
  mostrar('Testando...');
  const funciona = await testar(salvo);
  mostrar(
    funciona ? 'Seu TURN está funcionando.' : 'Seu TURN não respondeu (cota acabou ou senha mudou?).',
    funciona ? 'ok' : 'erro',
  );
});

$('remover').addEventListener('click', () => {
  salvarTurnsDoNavegador([]);
  atualizarTela();
  mostrar('Removido. Usando o TURN do site.');
});

atualizarTela();
