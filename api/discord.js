// POST /api/discord
// "Interactions Endpoint URL" do Discord: o Discord chama esta rota sempre que
// alguém usa o /live ou clica num botão do bot. Por isso o bot não precisa
// ficar ligado 24h — funciona de graça na Vercel.
import crypto from 'node:crypto';
import { criarSala, linkApresentador, json } from '../lib/sala.js';

const PING = 1;
const COMANDO = 2;
const BOTAO = 3;

const RESPOSTA_PONG = 1;
const RESPOSTA_MENSAGEM = 4;

const EFEMERA = 64; // mensagem que só quem clicou consegue ver
const COR = 0xe8443a; // vermelho do "REC"

// O Discord assina cada requisição. Se a assinatura não bater, recusamos —
// o próprio Discord testa isso quando você salva a URL no Developer Portal.
function assinaturaValida(corpo, assinatura, timestamp) {
  const chavePublica = process.env.DISCORD_PUBLIC_KEY;
  if (!chavePublica || !assinatura || !timestamp) return false;
  try {
    const chave = crypto.createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(chavePublica, 'hex').toString('base64url') },
      format: 'jwk',
    });
    return crypto.verify(null, Buffer.from(timestamp + corpo), chave, Buffer.from(assinatura, 'hex'));
  } catch {
    return false;
  }
}

function mensagemEfemera(conteudo, extra = {}) {
  return json({ type: RESPOSTA_MENSAGEM, data: { flags: EFEMERA, content: conteudo, ...extra } });
}

function comandoLive(request, interacao, usuario) {
  const titulo = interacao.data.options?.find((o) => o.name === 'titulo')?.value;
  const sala = criarSala(request, titulo);
  const nome = usuario.global_name || usuario.username;

  return json({
    type: RESPOSTA_MENSAGEM,
    data: {
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: `📼 ${sala.titulo || 'Live no LetsWatch'}`,
          url: sala.linkPublico,
          description: `**${nome}** vai apresentar a tela.\nAperte **▶ Assistir** para entrar, direto no navegador.`,
          color: COR,
          footer: { text: `Fita ${sala.codigo} · Rebobine antes de devolver` },
        },
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: '▶ Assistir', url: sala.linkPublico },
            {
              type: 2,
              style: 2,
              label: 'Sou o apresentador',
              custom_id: `apresentar:${sala.codigo}:${usuario.id}`,
            },
          ],
        },
      ],
    },
  });
}

function botaoApresentar(request, interacao, usuario) {
  const [, codigo, donoId] = interacao.data.custom_id.split(':');

  if (usuario.id !== donoId) {
    return mensagemEfemera('Só quem criou esta live pode apresentar. Use `/live` para criar a sua.');
  }

  const tituloEmbed = interacao.message?.embeds?.[0]?.title ?? '';
  const titulo = tituloEmbed.replace(/^📼\s*/, '').replace(/^Live no LetsWatch$/, '');
  const link = linkApresentador(request, codigo, titulo);

  return mensagemEfemera(
    'Este é o seu link de apresentador. **Não compartilhe**: quem tiver ele consegue transmitir na sala.',
    {
      components: [
        { type: 1, components: [{ type: 2, style: 5, label: 'Abrir painel do apresentador', url: link }] },
      ],
    },
  );
}

export async function POST(request) {
  const corpo = await request.text();
  const valida = assinaturaValida(
    corpo,
    request.headers.get('x-signature-ed25519'),
    request.headers.get('x-signature-timestamp'),
  );
  if (!valida) return new Response('Assinatura inválida', { status: 401 });

  const interacao = JSON.parse(corpo);
  if (interacao.type === PING) return json({ type: RESPOSTA_PONG });

  const usuario = interacao.member?.user ?? interacao.user;

  if (interacao.type === COMANDO && interacao.data?.name === 'live') {
    return comandoLive(request, interacao, usuario);
  }

  if (interacao.type === BOTAO && interacao.data?.custom_id?.startsWith('apresentar:')) {
    return botaoApresentar(request, interacao, usuario);
  }

  return mensagemEfemera('Comando desconhecido.');
}
