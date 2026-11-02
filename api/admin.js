// POST /api/admin  { "senha": "...", "codigo": "XXXXXXXX" }
// Confere a senha de admin (variável ADMIN_PASSWORD) e devolve um token que
// autoriza encerrar AQUELA sala. O painel do apresentador confere o token em
// /api/verificar antes de obedecer.
import { adminConfigurado, codigoValido, json, senhaAdminCorreta, tokenAdmin } from '../lib/sala.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export async function POST(request) {
  if (!adminConfigurado()) {
    return json({ erro: 'A opção de admin não está ativada: defina ADMIN_PASSWORD na Vercel.' }, 503);
  }

  let corpo = {};
  try {
    corpo = await request.json();
  } catch {
    // corpo inválido
  }

  if (!senhaAdminCorreta(corpo.senha)) {
    await esperar(1500); // atrasa quem tenta adivinhar a senha
    return json({ erro: 'Senha incorreta.' }, 401);
  }
  if (!codigoValido(corpo.codigo)) {
    return json({ erro: 'Código da sala inválido.' }, 400);
  }

  return json({ token: tokenAdmin(corpo.codigo) });
}
