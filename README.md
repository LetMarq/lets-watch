# LetsWatch

Lives de compartilhamento de tela, de pessoa para pessoa (P2P). Alguém digita `/live` no Discord, abre o painel, escolhe **tela inteira, janela ou guia** (igual ao Google Meet) e os amigos assistem pelo link, direto no navegador.

- Sem servidor de vídeo e sem cota: o vídeo vai direto do navegador de quem apresenta para o de quem assiste.
- Hospedagem 100% gratuita (Vercel + servidor público do PeerJS).
- Feito para grupos pequenos (até umas 5 pessoas assistindo).

## Como funciona

```
/live no Discord ──► Vercel (api/discord.js) ──► mensagem com o link "Assistir"
                                                  + botão "Sou o apresentador" (link secreto)

Apresentador (navegador) ──── vídeo direto (WebRTC) ────► cada espectador (navegador)
         ▲                                                        ▲
         └──────── servidor PeerJS: só apresenta um ao outro ─────┘
```

1. **Sinalização (PeerJS):** o apresentador se registra com o nome `letswatch-<código>`. Quem abre `/ver/<código>` sabe esse nome e pede para conectar. O servidor do PeerJS só faz a apresentação inicial.
2. **STUN:** cada navegador descobre o próprio IP público (servidores gratuitos do Google).
3. **Conexão direta:** os dois navegadores "furam" os roteadores e o vídeo passa a ir direto.
4. **TURN (opcional):** se a rede de alguém for muito restrita e a conexão direta falhar, um servidor TURN repassa o vídeo. Veja [TURN](#turn-opcional).

O link de apresentador tem uma chave (`?k=...`) que é uma assinatura do código da sala com o `LETSWATCH_SECRET`. Assim não precisamos de banco de dados.

## Estrutura

```
api/                    Funções serverless (rodam na Vercel)
  criar.js              POST /api/criar      cria uma sala pelo site
  verificar.js          GET  /api/verificar  confere a chave do apresentador
  config.js             GET  /api/config     servidores STUN/TURN e PeerJS
  discord.js            POST /api/discord    recebe o /live e os botões do Discord
lib/sala.js             Código compartilhado: gerar código, assinar a chave, montar links
public/                 Site (HTML, CSS, JS)
  index.html            Página inicial: criar sala sem Discord
  transmitir.html       Painel do apresentador        → /transmitir/<código>?k=...
  ver.html              Página de quem assiste       → /ver/<código>
  js/host.js            Lógica do apresentador (tela, microfone, conexões)
  js/viewer.js          Lógica do espectador (player, reconexão)
  js/common.js          Funções usadas pelos dois
  js/retro.js           Efeitos retrô: estática de TV e contador de fita
  style.css             Visual TV de tubo + VHS
scripts/
  dev.js                Servidor local para testes (npm run dev)
  registrar-comando.js  Registra o /live no Discord (npm run registrar-comando)
vercel.json             Rotas /ver/... e /transmitir/...
```

Não há dependências para instalar: tudo usa só o Node.js e o navegador. O PeerJS é carregado direto do CDN nas páginas.

## Rodar no seu computador

Precisa do [Node.js](https://nodejs.org) 20.12 ou mais novo.

```bash
npm run dev
```

Abra http://localhost:3000, crie uma sala, abra o painel e, em outra aba (ou janela anônima), o link de assistir. Para testar com amigos em outros computadores, publique na Vercel (abaixo): compartilhar tela só funciona em `localhost` ou em `https`.

## Colocar no ar (grátis)

### 1. Enviar para o GitHub

Na pasta do projeto:

```bash
git init
git add .
git commit -m "Primeira versão do LetsWatch"
git branch -M main
git remote add origin https://github.com/LetMarq/lets-watch.git
git push -u origin main
```

### 2. Publicar na Vercel

1. Entre em https://vercel.com com a sua conta do GitHub.
2. **Add New → Project** e escolha `lets-watch`.
3. Em **Framework Preset**, deixe **Other**. Não precisa de comando de build.
4. Em **Environment Variables**, adicione `LETSWATCH_SECRET` com um texto aleatório. Para gerar um:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
5. Clique em **Deploy**. Você ganha um endereço como `https://lets-watch.vercel.app`.

Pronto: o site já funciona sem o Discord. Cada `git push` publica uma nova versão automaticamente.

### 3. Criar o bot no Discord

1. Acesse https://discord.com/developers/applications e clique em **New Application**. Dê o nome `LetsWatch`.
2. Em **General Information**, copie o **Application ID** e a **Public Key**.
3. Em **Bot**, clique em **Reset Token** e copie o token. Ele é só para registrar o comando; não vai para a Vercel.
4. Na Vercel, adicione as variáveis `DISCORD_APP_ID` e `DISCORD_PUBLIC_KEY` e faça um novo deploy (**Deployments → ⋯ → Redeploy**).
5. De volta ao Discord, em **General Information → Interactions Endpoint URL**, coloque:
   ```
   https://SEU-PROJETO.vercel.app/api/discord
   ```
   e salve. O Discord testa a URL na hora; se der erro, confira a `DISCORD_PUBLIC_KEY` e se fez o redeploy.

### 4. Registrar o `/live` e convidar o bot

No seu computador, copie `.env.example` para `.env`, preencha `DISCORD_APP_ID` e `DISCORD_BOT_TOKEN` e rode:

```bash
npm run registrar-comando
```

O script mostra um link de convite. Abra, escolha o seu servidor e autorize. Agora é só digitar `/live` (ou `/live titulo: Maratona de filmes`).

> O arquivo `.env` está no `.gitignore` e nunca deve ir para o GitHub. Se o token vazar, clique em **Reset Token** de novo.

## Usando

1. **`/live`** no Discord: o bot posta a mensagem com **Assistir** e **Sou o apresentador**.
2. Quem criou clica em **Sou o apresentador** e recebe (só ela vê) o link do painel.
3. No painel, **Apresentar tela**: o navegador abre a escolha de tela inteira, janela ou guia.
4. Os outros clicam em **Assistir**. Quem abre antes do apresentador fica esperando e entra sozinho quando a live começar.

No painel dá para **trocar de tela** sem derrubar ninguém, ligar o **microfone**, mudar a **qualidade** e ver **quantas pessoas estão assistindo**. Na página de assistir há som, preencher a tela, picture-in-picture e tela cheia (atalhos **F** e **M**).

### Limitações

- **Apresentar só no computador** (Chrome, Edge ou Firefox). Assistir funciona em qualquer aparelho.
- **Som do computador:** marque "Compartilhar áudio" na janela de escolha. Funciona ao compartilhar uma **guia** (Chrome/Edge) ou a **tela inteira no Windows**. Ao compartilhar uma janela, normalmente vai sem som.
- **Upload do apresentador:** ele envia uma cópia para cada espectador. Com 3 pessoas assistindo em 1080p, são uns 6 a 8 Mbps de upload.
- **Privacidade:** por ser direto, as pessoas da live podem ver o IP público umas das outras. Entre amigos, tudo bem.
- **Servidor público do PeerJS:** é gratuito e não tem garantia. Se um dia ficar instável, dá para hospedar o seu (variáveis `PEER_*`).

## TURN (opcional)

Se alguém ficar preso em "Carregando a tela..." (comum em redes de empresa, faculdade ou alguns 4G), a conexão direta foi bloqueada. Crie uma conta num serviço de TURN com plano gratuito (por exemplo Metered ou Cloudflare) e cadastre na Vercel:

```
TURN_URL=turn:endereco-do-servidor:3478
TURN_USERNAME=usuario
TURN_CREDENTIAL=senha
```

Só o tráfego de quem não consegue conexão direta passa pelo TURN.

## Ideias para depois

- Chat na página de assistir (a conexão de dados P2P já existe).
- Câmera do apresentador num cantinho.
- Avisar no Discord quando a live começar e terminar.
- Trocar para um servidor de mídia (LiveKit) se o grupo crescer além de umas 5 pessoas.
