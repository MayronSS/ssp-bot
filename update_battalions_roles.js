const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();

const uri = process.env.MONGO_URI || 'mongodb+srv://simone:123@policia.dek7t83.mongodb.net/?appName=policia';
const Corporation = require('./src/database/models/Corporation');
const corporationsConfig = require('./src/config/corporations');

async function run() {
  console.log('Connecting to database...');
  await mongoose.connect(uri);
  console.log('Connected.');

  const tagsSlugs = ['ft', 'rota', 'baep', 'bprv'];
  
  // Find all corporations in the database
  const corps = await Corporation.find({});
  console.log(`Found ${corps.length} corporation documents in the database.`);

  for (const corp of corps) {
    let updated = false;

    // 1. Process config-based tag corporations (ft, rota, baep, bprv)
    if (tagsSlugs.includes(corp.slug) && corp.type === 'tag') {
      console.log(`\nProcessing tag corporation: ${corp.name} (${corp.slug}) for Guild: ${corp.guildId}`);
      
      // Get static resolved ranks from corporationsConfig
      const resolvedRanks = corporationsConfig.getResolvedRanks(corp.slug);
      
      // Map to ranks array with appropriate role IDs
      const updatedRanks = resolvedRanks.map(newRank => {
        let roleId = null;

        // Apply new role IDs requested by the user
        if (newRank.name === '2º Tenente PM') {
          roleId = '1524928196624126143';
        } else if (newRank.name === 'Soldado' || newRank.name === 'Soldado da FT') {
          roleId = '1523533364244647996';
        } else {
          // Keep existing role ID if present
          const existingRank = corp.ranks.find(r => r.name === newRank.name);
          roleId = existingRank ? existingRank.roleId : null;
        }

        return {
          name: newRank.name,
          shortName: newRank.shortName,
          level: newRank.level,
          emoji: newRank.emoji,
          roleId: roleId
        };
      });

      console.log(`Updating ranks for ${corp.slug}...`);
      corp.ranks = updatedRanks;
      updated = true;
    }

    // 2. Process cavpm tag corporation (custom or database-only)
    if (corp.slug === 'cavpm' && corp.type === 'tag') {
      console.log(`\nProcessing custom tag corporation: ${corp.name} (${corp.slug}) for Guild: ${corp.guildId}`);
      
      const updatedRanks = corp.ranks.map(r => {
        let roleId = r.roleId;
        if (r.name === 'Soldado') {
          roleId = '1523533364244647996';
        }
        return {
          name: r.name,
          shortName: r.shortName,
          level: r.level,
          emoji: r.emoji,
          roleId: roleId
        };
      });

      corp.ranks = updatedRanks;
      updated = true;
    }

    if (updated) {
      await corp.save();
      console.log(`Document for ${corp.slug} (Guild: ${corp.guildId}) saved successfully.`);
    }
  }

  await mongoose.disconnect();
  console.log('\nDisconnected from database. All updates completed!');
}

run().catch(console.error);
