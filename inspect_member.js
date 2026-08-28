const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

async function run() {
  await client.login(process.env.DISCORD_TOKEN);
  
  const guild = await client.guilds.fetch('1508542795240210452').catch(async () => {
    // Se o ID da guild for diferente, buscar a primeira
    const guilds = await client.guilds.fetch();
    return await client.guilds.fetch(guilds.first().id);
  });
  
  console.log(`Guild encontrada: ${guild.name} (${guild.id})`);
  
  // Buscar membro William Salim
  const members = await guild.members.fetch();
  const william = members.find(m => m.displayName.includes('William Salim') || m.nickname?.includes('William Salim'));
  
  if (!william) {
    console.log('Membro William Salim não encontrado.');
  } else {
    console.log(`Membro: ${william.user.tag} (${william.id})`);
    console.log('Roles do William:');
    william.roles.cache.forEach(role => {
      console.log(`- ${role.name}: ${role.id}`);
    });
  }
  
  client.destroy();
}

run().catch(console.error);
