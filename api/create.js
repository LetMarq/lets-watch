// POST /api/create  { "title": "..." }
// Creates a room from the website (no Discord needed).
import { createRoom, json } from '../lib/room.js';

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    // empty or invalid body: create without a title
  }
  return json(createRoom(request, body.title));
}
