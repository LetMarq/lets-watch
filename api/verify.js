// GET /api/verify?code=XXXXXXXX&k=KEY        → is the presenter key valid?
// GET /api/verify?code=XXXXXXXX&admin=TOKEN  → is the admin token valid?
import { isValidAdminToken, isValidPresenterKey, json } from '../lib/room.js';

export function GET(request) {
  const params = new URL(request.url).searchParams;
  const code = params.get('code');
  const ok = params.has('admin')
    ? isValidAdminToken(code, params.get('admin'))
    : isValidPresenterKey(code, params.get('k'));
  return json({ ok }, ok ? 200 : 403);
}
