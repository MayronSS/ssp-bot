const mongoose = require('mongoose');
const logger = require('../utils/logger');
const env = require('../config/env');

const CONNECTION_OPTIONS = {
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  heartbeatFrequencyMS: 10000,
  family: 4,
  maxPoolSize: 10,
};

let connectionListenersRegistered = false;
let driverListenersRegistered = false;
let lastHeartbeatWarning = 0;

function getErrorMessage(error) {
  return error?.message || String(error);
}

function registerConnectionListeners() {
  if (connectionListenersRegistered) return;
  connectionListenersRegistered = true;

  mongoose.connection.on('error', (err) => {
    logger.error('Erro na conexao MongoDB:', err);
  });

  mongoose.connection.on('reconnected', () => {
    logger.success('MongoDB reconectado');
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB desconectado');
  });
}

function registerDriverListeners() {
  if (driverListenersRegistered) return;
  driverListenersRegistered = true;

  const client = mongoose.connection.getClient();

  client.on('serverHeartbeatFailed', (event) => {
    const now = Date.now();
    if (now - lastHeartbeatWarning < 60000) return;

    lastHeartbeatWarning = now;
    logger.warn(`MongoDB heartbeat falhou: ${getErrorMessage(event.failure)}`);
  });
}

/**
 * Conexao com o MongoDB.
 * Chamada na inicializacao do bot.
 */
async function connectDatabase() {
  if (!env.MONGO_URI) {
    logger.error('MONGO_URI nao configurada no .env');
    process.exit(1);
  }

  registerConnectionListeners();

  try {
    await mongoose.connect(env.MONGO_URI, CONNECTION_OPTIONS);
    await mongoose.connection.db.admin().ping();
    registerDriverListeners();
    logger.success('Conexao com o MongoDB estabelecida');
  } catch (error) {
    logger.error('Erro ao conectar ao MongoDB:', error);

    if (getErrorMessage(error).includes('querySrv')) {
      logger.error('Falha ao resolver o DNS SRV do MongoDB Atlas. Verifique DNS, firewall ou rede.');
    }

    process.exit(1);
  }
}

module.exports = connectDatabase;
