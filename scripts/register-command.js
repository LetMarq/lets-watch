// Registers the /live and /help commands on Discord. Run it once (and again whenever the commands change):
//   npm run register-command
// Needs DISCORD_APP_ID and DISCORD_BOT_TOKEN in the .env file.
try {
  process.loadEnvFile();
} catch {
  // no .env: use system environment variables
}

const { DISCORD_APP_ID, DISCORD_BOT_TOKEN } = process.env;
if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) {
  console.error('Fill in DISCORD_APP_ID and DISCORD_BOT_TOKEN in the .env file');
  process.exit(1);
}

// Names and descriptions are shown inside Discord, so they stay in Portuguese.
const commands = [
  {
    name: 'live',
    description: 'Cria uma live no LetsWatch e posta o link para todos assistirem',
    type: 1,
    contexts: [0], // servers only
    integration_types: [0],
    options: [
      {
        type: 3, // string
        name: 'titulo',
        description: 'Título da live',
        required: false,
        max_length: 80,
      },
    ],
  },
  {
    name: 'help',
    description: 'Mostra como criar, apresentar e assistir uma live no LetsWatch',
    type: 1,
    contexts: [0, 1], // servers and DMs with the bot
    integration_types: [0],
  },
];

const response = await fetch(`https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands`, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(commands),
});

if (!response.ok) {
  console.error(`Error ${response.status}:`, await response.text());
  process.exit(1);
}

console.log('Commands /live and /help registered successfully!');
console.log(
  `Invite the bot to your server: https://discord.com/oauth2/authorize?client_id=${DISCORD_APP_ID}&scope=bot+applications.commands&permissions=0`,
);
