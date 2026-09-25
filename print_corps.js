const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();

const uri = process.env.MONGO_URI || 'mongodb+srv://simone:123@policia.dek7t83.mongodb.net/?appName=policia';

async function run() {
  await mongoose.connect(uri);
  const Corporation = mongoose.model('Corporation', new mongoose.Schema({}, { strict: false }));
  const corps = await Corporation.find({});
  for (const c of corps) {
    console.log(`Slug: ${c.slug}, Type: ${c.type}, Geral Role: ${c.roles?.geral}, Name: ${c.name}`);
  }
  await mongoose.disconnect();
}

run().catch(console.error);
