const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error("MONGO_URI nao configurada"); process.exit(1); }

const Ticket = require('./src/database/models/Ticket');
const LspdTranscript = require('./src/database/models/LspdTranscript');

// Definir AuditLog inline (modelo existe no PAINEL, nao no BOT)
const auditLogSchema = new mongoose.Schema({}, { strict: false, collection: 'auditlogs' });
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

async function run() {
  try {
    console.log("Conectando ao MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("Conectado.\n");

    const t = await Ticket.deleteMany({});
    console.log(`Tickets removidos: ${t.deletedCount}`);

    const tr = await LspdTranscript.deleteMany({});
    console.log(`Transcripts removidos: ${tr.deletedCount}`);

    const a = await AuditLog.deleteMany({});
    console.log(`Registros de atividade removidos: ${a.deletedCount}`);

    console.log("\nLimpeza concluida!");
  } catch (err) {
    console.error("Erro:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Conexao encerrada.");
  }
}

run();
