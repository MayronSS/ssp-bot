const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const { Client, GatewayIntentBits, Collection, Partials, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const env = require('./src/config/env');
const logger = require('./src/utils/logger');
const connectDatabase = require('./src/database/connection');
const { startApiServer } = require('./src/services/apiService');

// Tratamento global de erros
process.on('uncaughtException', (error) => {
  logger.error(`Exceção não tratada: ${error.message}`, error);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Rejeição de promessa não tratada:', reason instanceof Error ? reason : { stack: String(reason) });
});

// Criar cliente Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

client.commands = new Collection();

/**
 * Carrega todos os comandos da pasta src/commands.
 */
function loadCommands() {
  const commandsPath = path.join(__dirname, 'src', 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
  const commandsData = [];

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.data && command.execute) {
      client.commands.set(command.data.name, command);
      commandsData.push(command.data.toJSON());
      logger.info(`Comando carregado: /${command.data.name}`);
    }
  }

  return commandsData;
}

/**
 * Carrega todos os eventos da pasta src/events.
 */
function loadEvents() {
  const eventsPath = path.join(__dirname, 'src', 'events');
  const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'));

  for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
    logger.info(`Evento carregado: ${event.name}`);
  }
}

/**
 * Registra os slash commands na API do Discord.
 */
async function registerCommands(commandsData) {
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(env.CLIENT_ID, env.GUILD_ID),
      { body: commandsData }
    );
    logger.success(`${commandsData.length} comando(s) registrado(s) no servidor`);
  } catch (error) {
    logger.error('Erro ao registrar comandos:', error);
  }
}

/**
 * Inicialização principal.
 */
async function init() {
  console.log('\n');
  console.log('═══════════════════════════════════════');
  console.log('    SSP • Secretaria de Segurança Pública    ');
  console.log('═══════════════════════════════════════');
  console.log('');

  // 1. Iniciar o servidor HTTP IMEDIATAMENTE (Discloud precisa da porta ativa)
  startApiServer(client);

  // 2. Conectar ao MongoDB
  await connectDatabase();

  // 3. Carregar comandos
  const commandsData = loadCommands();

  // 4. Carregar eventos
  loadEvents();

  // 5. Login no Discord
  logger.info('Conectando ao Discord...');
  await client.login(env.DISCORD_TOKEN);

  // 6. Registrar slash commands
  await registerCommands(commandsData);
}

init().catch((error) => {
  logger.error('Falha na inicialização:', error);
  process.exit(1);
});
