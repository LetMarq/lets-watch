# LetsWatch

Peer-to-peer (P2P) screen-sharing lives. Someone types `/live` on Discord, opens the presenter panel, picks the **entire screen, a window or a tab** (just like Google Meet), and friends watch through a link, right in the browser.

- No media server and no quota: video goes straight from the presenter's browser to each viewer's browser.
- 100% free hosting (Vercel + the public PeerJS server).
- Made for small groups (up to about 5 viewers).

> The website itself is in Brazilian Portuguese; the code, comments and docs are in English.

## How it works

```
/live on Discord ──► Vercel (api/discord.js) ──► message with the "Assistir" (watch) link
                                                  + "Sou o apresentador" button (secret link)

Presenter (browser) ──── direct video (WebRTC) ────► each viewer (browser)
        ▲                                                   ▲
        └──────── PeerJS server: only introduces them ──────┘
```

1. **Signaling (PeerJS):** the presenter registers as `letswatch-<code>`. Anyone opening `/ver/<code>` knows that name and asks to connect. The PeerJS server only handles that first introduction.
2. **STUN:** each browser discovers its own public IP (free Google servers).
3. **Direct connection:** both browsers punch through their routers and the video starts flowing directly.
4. **TURN:** if someone's network is too restrictive and the direct connection fails, a TURN server relays the video. See [TURN](#turn-when-a-viewer-cant-connect).

The presenter link carries a key (`?k=...`): an HMAC signature of the room code made with `LETSWATCH_SECRET`. That's why there is no database.

## Project layout

```
api/                      Serverless functions (run on Vercel)
  create.js               POST /api/create   creates a room from the website
  verify.js               GET  /api/verify   checks the presenter key or an admin token
  admin.js                POST /api/admin    checks the admin password, returns a room token
  config.js               GET  /api/config   STUN/TURN and PeerJS servers
  discord.js              POST /api/discord  handles /live and the Discord buttons
lib/room.js               Shared code: room codes, signed keys, links
public/                   Website (HTML, CSS, JS)
  index.html              Home page: create a room without Discord
  present.html            Presenter panel         → /transmitir/<code>?k=...
  watch.html              Viewer page             → /ver/<code>
  admin.html              End any live            → /admin
  turn.html               Save your own TURN      → /turn
  js/host.js              Presenter logic (screen sharing, connections, idle timers)
  js/viewer.js            Viewer logic (player, reconnection, reactions)
  js/admin.js             Admin page logic
  js/turn.js              TURN page logic (test and save in the browser)
  js/home.js              Home page logic
  js/common.js            Helpers shared by the pages
  js/retro.js             Retro effects: TV static and tape counter
  style.css               CRT TV + VHS look
scripts/
  dev.js                  Local server for testing (npm run dev)
  register-command.js     Registers /live on Discord (npm run register-command)
vercel.json               Routes /ver/..., /transmitir/..., /admin and /turn
```

There are no dependencies to install: everything uses plain Node.js and the browser. PeerJS is loaded from a CDN in the pages.

## Run it locally

You need [Node.js](https://nodejs.org) 20.12 or newer.

```bash
npm run dev
```

Open http://localhost:3000, create a room, open the panel and, in another tab (or a private window), the watch link. To test with friends on other computers, deploy to Vercel (below): screen sharing only works on `localhost` or `https`.

## Deploy (free)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "First version of LetsWatch"
git branch -M main
git remote add origin https://github.com/LetMarq/lets-watch.git
git push -u origin main
```

### 2. Publish on Vercel

1. Sign in at https://vercel.com with your GitHub account.
2. **Add New → Project** and pick `lets-watch`.
3. Leave **Framework Preset** as **Other**. No build command is needed.
4. Under **Environment Variables**, add `LETSWATCH_SECRET` with a random string. To generate one:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
5. Click **Deploy**. You get an address like `https://lets-watch.vercel.app`.

The website already works without Discord. Every `git push` deploys a new version automatically.

### 3. Create the Discord bot

1. Go to https://discord.com/developers/applications and click **New Application**. Name it `LetsWatch`.
2. Under **General Information**, copy the **Application ID** and the **Public Key**.
3. Under **Bot**, click **Reset Token** and copy the token. It's only used to register the command and must **not** go to Vercel.
4. On Vercel, add `DISCORD_APP_ID` and `DISCORD_PUBLIC_KEY`, then redeploy (**Deployments → ⋯ → Redeploy**).
5. Back on Discord, under **General Information → Interactions Endpoint URL**, enter:
   ```
   https://YOUR-PROJECT.vercel.app/api/discord
   ```
   and save. Discord tests the URL right away; if it fails, check `DISCORD_PUBLIC_KEY` and that you redeployed.

### 4. Register `/live` and invite the bot

On your computer, copy `.env.example` to `.env`, fill in `DISCORD_APP_ID` and `DISCORD_BOT_TOKEN`, and run:

```bash
npm run register-command
```

The script prints an invite link. Open it, pick your server and authorize. Now type `/live` (or `/live titulo: Movie night`).

> `.env` is in `.gitignore` and must never go to GitHub. If the token leaks, click **Reset Token** again.

The bot has no gateway connection (it only answers interactions through the endpoint), so it always shows as offline in the member list. That's expected.

## Usage

1. **`/live`** on Discord: the bot posts a message with **Assistir** (watch) and **Sou o apresentador** (I'm the presenter).
2. Whoever created it clicks **Sou o apresentador** and gets the panel link (only they can see it).
3. In the panel, **Apresentar tela**: the browser opens the entire screen / window / tab picker.
4. Everyone else clicks **Assistir**. People who arrive before the presenter wait and join automatically when the live starts.

In the panel you can **switch screens** without dropping anyone, change the **quality** (Texto 1080p/15 fps, Fluido 720p/30 fps, Filme 1080p/30 fps) and see **how many people are watching**.

**Reactions:** viewers can send emojis (👍 ❤️ 😂 😮 👏 🔥 🎉 😢) with the 😀 button. They float up on everyone's screen and on the panel's monitor. The presenter can turn them off with the **Reações** switch. Only emojis from the list are accepted, at most 6 every 3 seconds per person. They are hidden in fullscreen.

**Saving resources:** if nobody watches for 5 minutes, screen sharing pauses by itself. If the room stays 30 minutes without sharing and without viewers, it closes and disconnects from the signaling server.

The watch page has sound, fill screen, picture-in-picture, fullscreen (shortcuts **F** and **M**) and an optional CRT effect (off by default).

### Limitations

- **Presenting only works on a computer** (Chrome, Edge or Firefox). Watching works on any device.
- **Computer sound:** sharing a **tab** sends its sound. For the **entire screen**, tick "Share system audio" in the picker (Chrome/Edge on Windows); this sends all PC sound, including Discord calls. **Windows of apps and games** are shared without sound: to stream a game with sound, share the entire screen with system audio.
- **Presenter upload:** one copy is sent to each viewer. With 3 viewers at 1080p, that's about 6 to 8 Mbps of upload.
- **Privacy:** since it's direct, people in the live can see each other's public IP. Fine among friends.
- **Public PeerJS server:** free and without guarantees. If it becomes unstable, host your own (`PEER_*` variables).

## Admin: end any live

1. On Vercel, add `ADMIN_PASSWORD` with a long password only you know, then redeploy.
2. Open `https://YOUR-SITE/admin`, enter the password and paste the watch link (or just the 8-character code shown in the bot message footer: "Fita AbC23xYz").
3. Click **Encerrar live**. The presenter panel and every viewer see that the live was ended by the administrator.

How it works: the server checks the password and returns a signed token valid only for that room. The admin page sends the token to the presenter panel, which checks it with the server before ending. The password never leaves the server.

Limitation: since rooms aren't stored in a database, anyone with the presenter link can reopen the room by reloading the panel. Blocking it for good would need a list of banned rooms (e.g. in Vercel KV).

## TURN: when a viewer can't connect

If the panel shows **0 viewers** while someone has the link open, or the viewer sees **"Sem conexão direta"**, someone's network blocked the direct connection. This is common on carrier internet with shared IPs (CGNAT), 4G/5G, corporate and university networks. The fix is a **TURN** server, which relays the video only for whoever can't connect directly.

### Everyone can use their own TURN (/turn page)

At `https://YOUR-SITE/turn`, anyone can save their own TURN, e.g. a free [ExpressTURN](https://www.expressturn.com/) account. The page tests the server before saving. It's stored **only in that browser** (localStorage) and goes **first** in the list: Chrome prefers the TURN servers at the top, and the site's servers stay as a fallback. Only one side of the live needs a working TURN, so usually only whoever is on 4G/5G needs to set one up.

### Several accounts on the site

Besides `TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL`, you can add up to 4 more accounts on Vercel: `TURN_URL_2`, `TURN_USERNAME_2`, `TURN_CREDENTIAL_2` and so on, up to `_5`. All of them are offered at once: if one runs out of quota, the others keep working. Only add the numbered variables you actually use (Vercel doesn't accept empty values).

### Default: Open Relay (free, no sign-up)

If no TURN is configured, the site automatically uses the free public [Open Relay](https://www.metered.ca/tools/openrelay/) server by Metered. No account, card or Vercel variable needed. Being public and shared, it has no guarantees; if it stops working, use one of the options below. To turn it off, set `TURN_OPENRELAY=false`.

### ExpressTURN (1,000 GB free per month, fixed username and password)

Create an account at https://www.expressturn.com and add `TURN_URL` (e.g. `turn:free.expressturn.com:3478`), `TURN_USERNAME` and `TURN_CREDENTIAL` on Vercel with the data from their dashboard. Then redeploy.

### Cloudflare (1,000 GB free per month, requires a card)

1. Create a free account at https://dash.cloudflare.com.
2. Open **Realtime** (shown as **Calls** on some accounts) → **TURN Server** → **Create**.
3. Give it a name (e.g. `letswatch`). Cloudflare shows the **Turn Token ID** and the **API Token**. Copy both right away: the token is only shown once.
4. On Vercel, under **Settings → Environment Variables**, add:
   ```
   CF_TURN_KEY_ID=the Turn Token ID
   CF_TURN_API_TOKEN=the API Token
   ```
5. Redeploy.

The site generates a temporary TURN credential for each visitor, so the Cloudflare token never reaches the browser.

### Metered with your own account

Create an account at https://dashboard.metered.ca/signup?tool=turnserver, copy the credentials URL (`https://YOUR-APP.metered.live/api/v1/turn/credentials?apiKey=...`) and add it on Vercel as `METERED_TURN_URL`. Then redeploy.

TURN priority: Cloudflare > Metered > `TURN_URL` > Open Relay. Extra `TURN_URL_2..5` accounts are always added on top.

## Ideas for later

- Chat on the watch page (the P2P data connection already exists).
- Presenter webcam in a corner.
- Notify Discord when the live starts and ends.
- Move to a media server (LiveKit) if the group grows beyond about 5 people.
