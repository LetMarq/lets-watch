// Registra o comando /live no Discord. Rode uma vez (e de novo só se mudar o comando):
//   npm run registrar-comando
// Precisa de DISCORD_APP_ID e DISCORD_BOT_TOKEN no arquivo .env
try {
  process.loadEnvFile();
} catch {
  // sem .env: usa as variáveis do sistema
}

const { DISCORD_APP_ID, DISCORD_BOT_TOKEN } = process.env;
if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) {
  console.error('Preencha DISCORD_APP_ID e DISCORD_BOT_TOKEN no arquivo .env');
  process.exit(1);
}

const comandos = [
  {
    name: 'live',
    description: 'Cria uma live no LetsWatch e posta o link para todos assistirem',
    type: 1,
    contexts: [0], // só em servidores
    integration_types: [0],
    options: [
      {
        type: 3, // texto
        name: 'titulo',
        description: 'Título da live',
        required: false,
        max_length: 80,
      },
    ],
  },
];

const resposta = await fetch(`https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands`, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(comandos),
});

if (!resposta.ok) {
  console.error(`Erro ${resposta.status}:`, await resposta.text());
  process.exit(1);
}

console.log('Comando /live registrado com sucesso!');
console.log(
  `Convide o bot para o seu servidor: https://discord.com/oauth2/authorize?client_id=${DISCORD_APP_ID}&scope=applications.commands`,
);
