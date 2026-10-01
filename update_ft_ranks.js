const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();

const uri = process.env.MONGO_URI || 'mongodb+srv://simone:123@policia.dek7t83.mongodb.net/?appName=policia';

async function run() {
  await mongoose.connect(uri);
  const Corporation = mongoose.model('Corporation', new mongoose.Schema({}, { strict: false }));
  
  const ft = await Corporation.findOne({ slug: 'ft' });
  if (!ft) {
    console.log('Corporação FT não encontrada.');
    await mongoose.disconnect();
    return;
  }

  // Atualizar as patentes da FT
  const updatedRanks = ft.ranks.map(rank => {
    if (rank.name === 'Soldado') {
      return {
        ...rank,
        name: 'Soldado da FT',
        roleId: '1523533364244647996'
      };
    }
    if (rank.name === 'CMD Geral Coronel PM' || rank.name === 'Coronel da FT') {
      return {
        ...rank,
        name: 'Coronel da FT',
        roleId: '1523530996023164989'
      };
    }
    return rank;
  });

  await Corporation.updateOne({ slug: 'ft' }, { $set: { ranks: updatedRanks } });
  console.log('Patentes da FT atualizadas com sucesso!');
  
  // Re-inspect
  const updatedFt = await Corporation.findOne({ slug: 'ft' });
  console.log('Novo Ranks da FT:', JSON.stringify(updatedFt.ranks, null, 2));

  await mongoose.disconnect();
}

run().catch(console.error);
