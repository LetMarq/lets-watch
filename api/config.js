// GET /api/config
// Diz ao navegador quais servidores usar para montar a conexão P2P:
// - iceServers: STUN (descobrir o próprio IP público) e TURN (repassar o vídeo
//   quando a rede bloqueia a conexão direta)
// - peer: servidor de sinalização PeerJS próprio (null = servidor público gratuito)
//
// TURN, em ordem de preferência:
// 1. Cloudflare (1.000 GB grátis/mês, pede cartão): CF_TURN_KEY_ID e CF_TURN_API_TOKEN
// 2. Metered com conta própria: METERED_TURN_URL
// 3. Qualquer TURN com usuário e senha fixos (ex.: ExpressTURN): TURN_URL, TURN_USERNAME, TURN_CREDENTIAL
// 4. Nada configurado: usa o servidor público e gratuito do Open Relay, sem cadastro.
//    Para desligar, defina TURN_OPENRELAY=false.
//
// Contas extras (ex.: outras contas grátis da ExpressTURN): TURN_URL_2,
// TURN_USERNAME_2, TURN_CREDENTIAL_2 ... até _5. O navegador tenta todas ao
// mesmo tempo: se a cota de uma acabar, as outras continuam funcionando.
import crypto from 'node:crypto';
import { json } from '../lib/sala.js';

// Open Relay (https://www.metered.ca/tools/openrelay/): servidor TURN gratuito
// da Metered. O segredo abaixo é público, publicado por eles para uso livre.
// A senha é gerada no formato padrão "TURN REST API": usuário = validade:nome,
// senha = HMAC-SHA1 do usuário com o segredo.
const OPENRELAY_HOST = 'staticauth.openrelay.metered.ca';
const OPENRELAY_SEGREDO = 'openrelayprojectsecret';

function turnOpenRelay() {
  const validade = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24 h
  const username = `${validade}:letswatch`;
  const credential = crypto.createHmac('sha1', OPENRELAY_SEGREDO).update(username).digest('base64');
  return [
    {
      urls: [
        `turn:${OPENRELAY_HOST}:80`,
        `turn:${OPENRELAY_HOST}:80?transport=tcp`,
        `turn:${OPENRELAY_HOST}:443?transport=tcp`,
        `turns:${OPENRELAY_HOST}:443?transport=tcp`,
      ],
      username,
      credential,
    },
  ];
}

const STUN_PADRAO = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };

function lista(valor) {
  return String(valor).split(',').map((s) => s.trim()).filter(Boolean);
}

// A porta 53 costuma ser bloqueada nos navegadores e só atrasa a conexão.
function semPorta53(servidores) {
  return servidores
    .map((s) => {
      const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
      return { ...s, urls };
    })
    .filter((s) => s.urls.length);
}

async function turnCloudflare(env) {
  const resposta = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.CF_TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_TURN_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: 86400 }), // credencial vale 24 h
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!resposta.ok) throw new Error(`Cloudflare TURN respondeu ${resposta.status}`);
  const { iceServers } = await resposta.json();
  return semPorta53(iceServers);
}

async function turnMetered(env) {
  const resposta = await fetch(env.METERED_TURN_URL, { signal: AbortSignal.timeout(5000) });
  if (!resposta.ok) throw new Error(`Metered TURN respondeu ${resposta.status}`);
  return semPorta53(await resposta.json());
}

async function servidoresTurn(env) {
  try {
    if (env.CF_TURN_KEY_ID && env.CF_TURN_API_TOKEN) return await turnCloudflare(env);
    if (env.METERED_TURN_URL) return await turnMetered(env);
  } catch (erro) {
    console.error('Não foi possível obter o TURN:', erro.message);
    return [];
  }
  if (env.TURN_URL) {
    return [{ urls: lista(env.TURN_URL), username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL }];
  }
  if (env.TURN_OPENRELAY !== 'false') return turnOpenRelay();
  return [];
}

function turnsExtras(env) {
  const extras = [];
  for (let i = 2; i <= 5; i++) {
    const url = env[`TURN_URL_${i}`];
    if (!url) continue;
    extras.push({ urls: lista(url), username: env[`TURN_USERNAME_${i}`], credential: env[`TURN_CREDENTIAL_${i}`] });
  }
  return extras;
}

export async function GET() {
  const env = process.env;
  const turn = [...(await servidoresTurn(env)), ...turnsExtras(env)];

  let peer = null;
  if (env.PEER_HOST) {
    peer = {
      host: env.PEER_HOST,
      port: Number(env.PEER_PORT || 443),
      path: env.PEER_PATH || '/',
      secure: env.PEER_SECURE !== 'false',
    };
  }

  return json({ peer, iceServers: [STUN_PADRAO, ...turn], temTurn: turn.length > 0 });
}
