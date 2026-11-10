// POST /api/discord
// Discord "Interactions Endpoint URL": Discord calls this route whenever
// someone uses /live or clicks one of the bot's buttons. That's why the bot
// doesn't need to stay online 24/7 — it runs for free on Vercel.
import crypto from 'node:crypto';
import { baseUrl, createRoom, json, presenterLink } from '../lib/room.js';

const INTERACTION_PING = 1;
const INTERACTION_COMMAND = 2;
const INTERACTION_BUTTON = 3;

const RESPONSE_PONG = 1;
const RESPONSE_MESSAGE = 4;

const EPHEMERAL = 64; // message only the person who clicked can see
const EMBED_COLOR = 0xe8443a; // the "REC" red
const DEFAULT_TITLE = 'Live no LetsWatch';

// "present:" is the current button id; "apresentar:" is kept so buttons on
// messages posted before the code was translated keep working.
const PRESENT_BUTTON = /^(present|apresentar):/;

// Discord signs every request. If the signature doesn't match, we refuse —
// Discord itself tests this when you save the URL in the Developer Portal.
function isValidSignature(body, signature, timestamp) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey || !signature || !timestamp) return false;
  try {
    const key = crypto.createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey, 'hex').toString('base64url') },
      format: 'jwk',
    });
    return crypto.verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

function ephemeralMessage(content, extra = {}) {
  return json({ type: RESPONSE_MESSAGE, data: { flags: EPHEMERAL, content, ...extra } });
}

function handleLiveCommand(request, interaction, user) {
  // The option name stays in Portuguese because people see it in Discord.
  const title = interaction.data.options?.find((option) => option.name === 'titulo')?.value;
  const room = createRoom(request, title);
  const name = user.global_name || user.username;

  return json({
    type: RESPONSE_MESSAGE,
    data: {
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: `📼 ${room.title || DEFAULT_TITLE}`,
          url: room.watchLink,
          description: `**${name}** vai apresentar a tela.\nAperte **▶ Assistir** para entrar, direto no navegador.`,
          color: EMBED_COLOR,
          footer: { text: `Fita ${room.code} · Rebobine antes de devolver` },
        },
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: '▶ Assistir', url: room.watchLink },
            {
              type: 2,
              style: 2,
              label: 'Sou o apresentador',
              custom_id: `present:${room.code}:${user.id}`,
            },
          ],
        },
      ],
    },
  });
}

// /help: a quick guide that only the person who typed it can see.
// The text is shown in Discord, so it stays in Portuguese.
function handleHelpCommand(request) {
  const site = baseUrl(request);
  return json({
    type: RESPONSE_MESSAGE,
    data: {
      flags: EPHEMERAL,
      embeds: [
        {
          title: '📼 LetsWatch · Como usar',
          description: 'Compartilhe a tela com a galera, direto no navegador. Sem login e sem instalar nada.',
          color: EMBED_COLOR,
          fields: [
            {
              name: '🎬 Criar uma live',
              value: 'Digite `/live` ou `/live titulo: Noite de filme`. O bot posta a mensagem com o link para todo mundo.',
            },
            {
              name: '📺 Apresentar',
              value:
                'Quem criou a live clica em **Sou o apresentador** e abre o painel no computador (Chrome, Edge ou Firefox). ' +
                'Aperte **▶ Apresentar tela** e escolha a tela inteira, uma janela ou uma guia.',
            },
            {
              name: '🔊 Som do computador',
              value:
                'Para deixar **as vozes do Discord de fora**, compartilhe a **janela** do jogo/programa ou a **guia** do vídeo e ligue a opção de áudio. ' +
                'Janelas com som precisam do Edge ou Chrome 141+; o jogo precisa estar em modo janela ou sem bordas para aparecer na lista. ' +
                'A **tela inteira** com "Compartilhar áudio do sistema" manda o som do PC todo, Discord junto.',
            },
            {
              name: '👀 Assistir',
              value:
                'Clique em **▶ Assistir**. Funciona no celular também. Quem chega antes do apresentador espera e a tela aparece sozinha. ' +
                'A página abre no mudo: clique em **Ativar som**. Atalhos: **F** tela cheia, **M** mudo, **↑ ↓** volume.',
            },
            {
              name: '📶 Travando ou sem conexão?',
              value:
                'No painel, use a qualidade **Fluido** para vídeos e jogos. O visor embaixo da contagem mostra se o limite é a internet de quem transmite. ' +
                'Se quem assiste ficar em "Sem conexão direta" (comum no 4G/5G), cadastre um TURN grátis no botão abaixo.',
            },
          ],
          footer: { text: 'Rebobine antes de devolver' },
        },
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: 'Abrir o LetsWatch', url: `${site}/` },
            { type: 2, style: 5, label: 'Cadastrar meu TURN', url: `${site}/turn` },
          ],
        },
      ],
    },
  });
}

function handlePresentButton(request, interaction, user) {
  const [, code, ownerId] = interaction.data.custom_id.split(':');

  if (user.id !== ownerId) {
    return ephemeralMessage('Só quem criou esta live pode apresentar. Use `/live` para criar a sua.');
  }

  const embedTitle = interaction.message?.embeds?.[0]?.title ?? '';
  const title = embedTitle.replace(/^📼\s*/, '').replace(new RegExp(`^${DEFAULT_TITLE}$`), '');
  const link = presenterLink(request, code, title);

  return ephemeralMessage(
    'Este é o seu link de apresentador. **Não compartilhe**: quem tiver ele consegue transmitir na sala.',
    {
      components: [
        { type: 1, components: [{ type: 2, style: 5, label: 'Abrir painel do apresentador', url: link }] },
      ],
    },
  );
}

export async function POST(request) {
  const body = await request.text();
  const valid = isValidSignature(
    body,
    request.headers.get('x-signature-ed25519'),
    request.headers.get('x-signature-timestamp'),
  );
  if (!valid) return new Response('Invalid signature', { status: 401 });

  const interaction = JSON.parse(body);
  if (interaction.type === INTERACTION_PING) return json({ type: RESPONSE_PONG });

  const user = interaction.member?.user ?? interaction.user;

  if (interaction.type === INTERACTION_COMMAND && interaction.data?.name === 'live') {
    return handleLiveCommand(request, interaction, user);
  }

  if (interaction.type === INTERACTION_COMMAND && interaction.data?.name === 'help') {
    return handleHelpCommand(request);
  }

  if (interaction.type === INTERACTION_BUTTON && PRESENT_BUTTON.test(interaction.data?.custom_id ?? '')) {
    return handlePresentButton(request, interaction, user);
  }

  return ephemeralMessage('Comando desconhecido.');
}
