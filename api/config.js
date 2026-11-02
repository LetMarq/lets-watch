// GET /api/config
// Diz ao navegador quais servidores usar para montar a conexão P2P:
// - iceServers: STUN (descobrir o próprio IP público) e, se houver, TURN (repasse)
// - peer: servidor de sinalização PeerJS próprio (null = servidor público gratuito)
import { json } from '../lib/sala.js';

function lista(valor) {
  return String(valor).split(',').map((s) => s.trim()).filter(Boolean);
}

export function GET() {
  const env = process.env;

  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  if (env.TURN_URL) {
    iceServers.push({
      urls: lista(env.TURN_URL),
      username: env.TURN_USERNAME,
      credential: env.TURN_CREDENTIAL,
    });
  }

  let peer = null;
  if (env.PEER_HOST) {
    peer = {
      host: env.PEER_HOST,
      port: Number(env.PEER_PORT || 443),
      path: env.PEER_PATH || '/',
      secure: env.PEER_SECURE !== 'false',
    };
  }

  return json({ peer, iceServers });
}
