// GET /api/verificar?codigo=XXXXXXXX&k=CHAVE      → a chave do apresentador é válida?
// GET /api/verificar?codigo=XXXXXXXX&admin=TOKEN  → o token de admin é válido?
import { chaveValida, json, tokenAdminValido } from '../lib/sala.js';

export function GET(request) {
  const params = new URL(request.url).searchParams;
  const codigo = params.get('codigo');
  const ok = params.has('admin')
    ? tokenAdminValido(codigo, params.get('admin'))
    : chaveValida(codigo, params.get('k'));
  return json({ ok }, ok ? 200 : 403);
}
