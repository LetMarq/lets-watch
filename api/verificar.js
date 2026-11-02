// GET /api/verificar?codigo=XXXXXXXX&k=CHAVE
// Usado pelo painel do apresentador para conferir se o link é válido.
import { chaveValida, json } from '../lib/sala.js';

export function GET(request) {
  const params = new URL(request.url).searchParams;
  const ok = chaveValida(params.get('codigo'), params.get('k'));
  return json({ ok }, ok ? 200 : 403);
}
