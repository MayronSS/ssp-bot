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
  } else {
    console.log('FT Ranks:', JSON.stringify(ft.ranks, null, 2));
  }
  await mongoose.disconnect();
}

run().catch(console.error);
