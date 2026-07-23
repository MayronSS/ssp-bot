const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();

const uri = process.env.MONGO_URI || 'mongodb+srv://simone:123@policia.dek7t83.mongodb.net/?appName=policia';
const Corporation = require('./src/database/models/Corporation');

async function run() {
  await mongoose.connect(uri);
  const corps = await Corporation.find({});
  for (const c of corps) {
    console.log(`\n======================================================`);
    console.log(`GuildId: ${c.guildId} | Slug: ${c.slug} | Name: ${c.name} | Type: ${c.type}`);
    console.log(`Ranks:`);
    for (const r of c.ranks) {
      console.log(`  - Level ${r.level}: ${r.name} (${r.shortName}) -> roleId: ${r.roleId}`);
    }
  }
  await mongoose.disconnect();
}

run().catch(console.error);
