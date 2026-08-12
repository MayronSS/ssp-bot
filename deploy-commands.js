/**
 * Script independente para registrar/atualizar slash commands.
 * Execute: node deploy-commands.js
 */
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const commands = [];
const commandsPath = path.join(__dirname, 'src', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

console.log('═══════════════════════════════════════');
console.log('   LSPD • Registro de Slash Commands   ');
console.log('═══════════════════════════════════════\n');

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    commands.push(command.data.toJSON());
    console.log(`✅ Comando carregado: /${command.data.name}`);
  } else {
    console.log(`⚠️ Ignorado (sem data/execute): ${file}`);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`\nRegistrando ${commands.length} comando(s) no servidor...`);

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log(`✅ ${commands.length} comando(s) registrado(s) com sucesso!`);
  } catch (error) {
    console.error('❌ Erro ao registrar comandos:', error);
  }
})();
