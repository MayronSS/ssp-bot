const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI nao configurada no .env");
  process.exit(1);
}

const Ponto = require('./src/database/models/Ponto');

async function run() {
  try {
    console.log("Conectando ao MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("Conexao estabelecida.");

    const abertos = await Ponto.find({ status: 'aberto' });
    console.log(`Encontrados ${abertos.length} pontos abertos.`);

    if (abertos.length === 0) {
      console.log("Nenhum ponto aberto para fechar.");
    } else {
      const deleteResult = await Ponto.deleteMany({ status: 'aberto' });
      console.log(`Removidos ${deleteResult.deletedCount} pontos abertos.`);
    }

    console.log("Operacao concluida com sucesso!");
  } catch (error) {
    console.error("Erro durante a execucao:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Conexao com o MongoDB encerrada.");
  }
}

run();
