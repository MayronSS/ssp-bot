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

    console.log("Apagando todos os registros de pontos fechados...");
    const deleteResult = await Ponto.deleteMany({ status: 'fechado' });
    console.log(`Sucesso: ${deleteResult.deletedCount} registros de pontos fechados foram removidos.`);

    console.log("Resetando a duracao de pontos abertos ativos para 0...");
    const updateResult = await Ponto.updateMany({ status: 'aberto' }, { $set: { durationMs: 0 } });
    console.log(`Sucesso: ${updateResult.modifiedCount} pontos abertos ativos foram atualizados.`);

    console.log("Operacao concluida com sucesso!");
  } catch (error) {
    console.error("Erro durante a execucao:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Conexao com o MongoDB encerrada.");
  }
}

run();
