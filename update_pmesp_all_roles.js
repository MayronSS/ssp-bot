const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();

const uri = process.env.MONGO_URI || 'mongodb+srv://simone:123@policia.dek7t83.mongodb.net/?appName=policia';
const Corporation = require('./src/database/models/Corporation');
const corporationsConfig = require('./src/config/corporations');

const RANK_ROLE_MAP = {
  'Soldado PM 2ª Classe': '1510829632855740456',
  'Soldado PM 1ª Classe': '1510829631299915928',
  'Soldado': '1523533364244647996',
  'Soldado da FT': '1523533364244647996',
  'Cabo PM': '1510829629701750787',
  '3º Sargento PM': '1510829628863021148',
  '2º Sargento PM': '1510829627860451418',
  '1º Sargento PM': '1510829626652622871',
  'Subtenente PM': '1510829625582944266',
  '2º Tenente PM': '1524928196624126143',
  '1º Tenente PM': '1510829624601346109',
  'Capitão PM': '1510829623187865711',
  'Major PM': '1510829621816332400',
  'Tenente-Coronel PM': '1510829616997072977',
  'Coronel PM': '1523530996023164989',
  'CMD Geral Coronel PM': '1510829616149954660',
  'Coronel da FT': '1523530996023164989',
};

async function run() {
  console.log('Conectando ao banco de dados...');
  await mongoose.connect(uri);
  console.log('Conectado com sucesso.');

  const corps = await Corporation.find({});
  console.log(`Encontradas ${corps.length} corporações no banco de dados.`);

  for (const corp of corps) {
    let updated = false;

    // Atualizar cargos do sistema se for PMESP
    if (corp.slug === 'pmesp') {
      if (!corp.roles) corp.roles = {};
      corp.roles.comando = '1510829613474119843';
      corp.roles.preAprovado = '1510829636433481734';
      corp.roles.recruta = '1510829632855740456';
      corp.roles.geral = '1510829612274548766';
      updated = true;
    }

    // Atualizar roleIds das patentes
    if (corp.ranks && corp.ranks.length > 0) {
      const updatedRanks = corp.ranks.map(rank => {
        const mappedRoleId = RANK_ROLE_MAP[rank.name];
        return {
          ...rank.toObject ? rank.toObject() : rank,
          roleId: mappedRoleId || rank.roleId || null,
        };
      });
      corp.ranks = updatedRanks;
      updated = true;
    }

    // Atualizar patentes exclusivas (ex: Boina Cinza da ROTA)
    if (corp.slug === 'rota' && corp.exclusiveRanks) {
      corp.exclusiveRanks = corp.exclusiveRanks.map(ex => {
        if (ex.name === 'Estagiário Boina Cinza') {
          return { ...ex.toObject ? ex.toObject() : ex, roleId: '1510829681027448935' };
        }
        return ex;
      });
      updated = true;
    }

    if (updated) {
      await corp.save();
      console.log(`✅ Corporação ${corp.name} (${corp.slug}) atualizada com sucesso!`);
    }
  }

  await mongoose.disconnect();
  console.log('\nDesconectado do banco. Atualização concluída!');
}

run().catch(console.error);
