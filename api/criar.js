// POST /api/criar  { "titulo": "..." }
// Cria uma sala pelo site (sem precisar do Discord).
import { criarSala, json } from '../lib/sala.js';

export async function POST(request) {
  let corpo = {};
  try {
    corpo = await request.json();
  } catch {
    // corpo vazio ou inválido: cria sem título
  }
  return json(criarSala(request, corpo.titulo));
}
