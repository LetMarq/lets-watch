import { copiarTexto } from './common.js';
import { criarEstatica } from './retro.js';

const form = document.getElementById('form-criar');
const botaoCriar = form.querySelector('button[type="submit"]');
const textoBotao = botaoCriar.textContent;
const fita = document.getElementById('fita');

// A TV da página inicial fica "fora do ar" até a sala ser criada.
const estatica = criarEstatica(document.getElementById('estatica'));
estatica.ligar();

function mostrarTvPronta() {
  estatica.desligar();
  document.getElementById('estatica').classList.add('escondido');
  document.getElementById('estatica-barra').classList.add('escondido');
  document.getElementById('tv-sem-sinal').classList.add('escondido');
  const pronta = document.getElementById('tv-pronta');
  pronta.classList.remove('escondido');
  pronta.classList.add('ligando');
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  botaoCriar.disabled = true;
  botaoCriar.textContent = '● Gravando...';
  fita.classList.add('gravando');

  try {
    const [resposta] = await Promise.all([
      fetch('/api/criar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ titulo: form.titulo.value }),
      }),
      esperar(900), // tempo de ver os carretéis girando
    ]);
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const sala = await resposta.json();

    document.getElementById('etiqueta-titulo').textContent = sala.titulo || 'Live sem título';
    document.getElementById('etiqueta-codigo').textContent = `FITA ${sala.codigo}`;
    document.getElementById('link-publico').value = sala.linkPublico;
    document.getElementById('link-apresentador').value = sala.linkApresentador;
    document.getElementById('abrir-painel').href = sala.linkApresentador;
    document.getElementById('formulario').classList.add('escondido');
    document.getElementById('resultado').classList.remove('escondido');
    mostrarTvPronta();
  } catch (erro) {
    console.error(erro);
    alert('Não foi possível criar a sala. Tente de novo.');
  } finally {
    fita.classList.remove('gravando');
    botaoCriar.disabled = false;
    botaoCriar.textContent = textoBotao;
  }
});

document.querySelectorAll('[data-copiar]').forEach((botao) => {
  botao.addEventListener('click', () => {
    copiarTexto(document.getElementById(botao.dataset.copiar).value, botao);
  });
});
