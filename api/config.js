// GET /api/config
// Tells the browser which servers to use to set up the P2P connection:
// - iceServers: STUN (discover the public IP) and TURN (relay the video when
//   the network blocks the direct connection)
// - peer: self-hosted PeerJS signaling server (null = free public server)
//
// TURN, in order of preference:
// 1. Cloudflare (1,000 GB free/month, needs a card): CF_TURN_KEY_ID and CF_TURN_API_TOKEN
// 2. Metered with your own account: METERED_TURN_URL
// 3. Any TURN with fixed username/password (e.g. ExpressTURN): TURN_URL, TURN_USERNAME, TURN_CREDENTIAL
// 4. Nothing configured: the free public Open Relay server, no sign-up.
//    To turn it off, set TURN_OPENRELAY=false.
//
// Extra accounts (e.g. friends' free ExpressTURN accounts): TURN_URL_2,
// TURN_USERNAME_2, TURN_CREDENTIAL_2 ... up to _5. The browser tries all of
// them at once: if one runs out of quota, the others keep working.
import crypto from 'node:crypto';
import { json } from '../lib/room.js';

// Open Relay (https://www.metered.ca/tools/openrelay/): free TURN server by
// Metered. The secret below is public, published by them for anyone to use.
// Credentials follow the standard "TURN REST API" format:
// username = expiry:name, password = HMAC-SHA1(username, secret).
const OPENRELAY_HOST = 'staticauth.openrelay.metered.ca';
const OPENRELAY_SECRET = 'openrelayprojectsecret';

const DEFAULT_STUN = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };

function openRelayTurn() {
  const expiry = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24 h
  const username = `${expiry}:letswatch`;
  const credential = crypto.createHmac('sha1', OPENRELAY_SECRET).update(username).digest('base64');
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

function splitList(value) {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

// Port 53 is often blocked in browsers and only slows the connection down.
function withoutPort53(servers) {
  return servers
    .map((server) => {
      const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
        (url) => !/:53(\?|$)/.test(url),
      );
      return { ...server, urls };
    })
    .filter((server) => server.urls.length);
}

async function cloudflareTurn(env) {
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.CF_TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_TURN_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: 86400 }), // credential valid for 24 h
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) throw new Error(`Cloudflare TURN responded ${response.status}`);
  const { iceServers } = await response.json();
  return withoutPort53(iceServers);
}

async function meteredTurn(env) {
  const response = await fetch(env.METERED_TURN_URL, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Metered TURN responded ${response.status}`);
  return withoutPort53(await response.json());
}

async function mainTurnServers(env) {
  try {
    if (env.CF_TURN_KEY_ID && env.CF_TURN_API_TOKEN) return await cloudflareTurn(env);
    if (env.METERED_TURN_URL) return await meteredTurn(env);
  } catch (error) {
    console.error('Could not get TURN credentials:', error.message);
    return [];
  }
  if (env.TURN_URL) {
    return [{ urls: splitList(env.TURN_URL), username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL }];
  }
  if (env.TURN_OPENRELAY !== 'false') return openRelayTurn();
  return [];
}

function extraTurnServers(env) {
  const extras = [];
  for (let i = 2; i <= 5; i++) {
    const url = env[`TURN_URL_${i}`];
    if (!url) continue; // not configured: skip
    extras.push({
      urls: splitList(url),
      username: env[`TURN_USERNAME_${i}`],
      credential: env[`TURN_CREDENTIAL_${i}`],
    });
  }
  return extras;
}

export async function GET() {
  const env = process.env;
  const turn = [...(await mainTurnServers(env)), ...extraTurnServers(env)];

  let peer = null;
  if (env.PEER_HOST) {
    peer = {
      host: env.PEER_HOST,
      port: Number(env.PEER_PORT || 443),
      path: env.PEER_PATH || '/',
      secure: env.PEER_SECURE !== 'false',
    };
  }

  return json({ peer, iceServers: [DEFAULT_STUN, ...turn], hasTurn: turn.length > 0 });
}
