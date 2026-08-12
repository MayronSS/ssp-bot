const http = require('http');
const env = require('../config/env');
const logger = require('../utils/logger');
const pontoService = require('../modules/ponto/ponto.service');

function startApiServer(client) {
  const host = env.PONTO_API_HOST || '127.0.0.1';
  const port = env.PONTO_API_PORT || 3000;
  const apiKey = env.PONTO_API_KEY;

  if (apiKey === 'TROCAR_POR_TOKEN_SEGURO_DO_BATE_PONTO' || apiKey === 'lspd_ponto_secret_token_change_me') {
    logger.warn('[API] Alerta de Segurança: PONTO_API_KEY ainda está configurada com o token padrão ou de exemplo!');
  }

  const server = http.createServer(async (req, res) => {
    // Definir cabeçalhos padrão para JSON
    res.setHeader('Content-Type', 'application/json');

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health Check — GET / ou GET /api/health
    if (req.method === 'GET' && (req.url === '/' || req.url === '/api/health')) {
      res.writeHead(200);
      res.end(JSON.stringify({ 
        success: true, 
        service: 'SSP Bot — API de Bate-Ponto',
        status: 'online',
        discord: client.isReady() ? 'connected' : 'connecting',
        timestamp: new Date().toISOString()
      }));
      return;
    }

    // Aceitar apenas POST /api/duty
    if (req.url === '/api/duty' && req.method === 'POST') {
      // 0. Verificar se o Discord está pronto
      if (!client.isReady()) {
        res.writeHead(503);
        res.end(JSON.stringify({ success: false, message: 'Bot ainda está iniciando. Tente novamente em alguns segundos.' }));
        return;
      }

      // 1. Validar Token de Autorização
      const authHeader = req.headers['authorization'];
      const expectedAuth = `Bearer ${apiKey}`;
      
      if (!authHeader || authHeader !== expectedAuth) {
        logger.warn(`[API] Tentativa de acesso não autorizada de ${req.socket.remoteAddress}`);
        res.writeHead(401);
        res.end(JSON.stringify({ success: false, message: 'Não autorizado. Token inválido.' }));
        return;
      }

      // 2. Ler o corpo da requisição com limite de tamanho (10KB)
      let body = '';
      let tooBig = false;

      req.on('data', chunk => {
        body += chunk.toString();
        // Limite de 10 KB
        if (body.length > 10240) {
          tooBig = true;
          req.destroy(); // Fecha a conexão
        }
      });

      req.on('end', async () => {
        if (tooBig) {
          res.writeHead(413);
          res.end(JSON.stringify({ success: false, message: 'Payload Too Large. Máximo de 10KB permitido.' }));
          return;
        }

        try {
          const payload = JSON.parse(body);
          const { discord: rawDiscord, action, job, name } = payload;
          const discord = rawDiscord ? String(rawDiscord).replace(/\D/g, '') : null;

          // Validação de presença
          if (action !== 'punch_out_all' && (!discord || !action || !job || !name)) {
            res.writeHead(400);
            res.end(JSON.stringify({ 
              success: false, 
              message: 'Campos obrigatórios ausentes. Certifique-se de enviar "discord", "action", "job" e "name".' 
            }));
            return;
          }

          // Obter a Guild do Discord
          const guild = await client.guilds.fetch(env.GUILD_ID).catch(() => null);
          if (!guild) {
            logger.error('[API] Guild configurada não encontrada no cache ou fetch.');
            res.writeHead(500);
            res.end(JSON.stringify({ success: false, message: 'Erro interno: Servidor do Discord não encontrado.' }));
            return;
          }

          // Mapeamento de Job/Corporation/Battalion
          let corporationSlug = 'pmesp';
          let battalionSlug = null;

          if (action !== 'punch_out_all') {
            const jobLower = String(job).toLowerCase();
            if (['pmesp', 'ft', 'rota', 'baep', 'bprv'].includes(jobLower)) {
              corporationSlug = 'pmesp';
              if (jobLower !== 'pmesp') {
                battalionSlug = jobLower;
              }
            } else if (jobLower === 'pcesp') {
              corporationSlug = 'pcesp';
            } else {
              // Logar aviso de job desconhecido, mas processar como pmesp por padrão
              logger.warn(`[API] Job desconhecido recebido do FiveM: "${job}". Usando fallback pmesp.`);
              corporationSlug = 'pmesp';
            }
          }

          let result;
          if (action === 'punch_in') {
            result = await pontoService.registrarEntradaAPI({
              guild,
              userId: discord,
              username: name,
              corporationSlug,
              battalionSlug
            });
          } else if (action === 'punch_out') {
            result = await pontoService.registrarSaidaAPI({
              guild,
              userId: discord,
              corporationSlug
            });
          } else if (action === 'punch_out_all') {
            result = await pontoService.encerrarTodosPontos({
              guild,
              actorUser: client.user,
              saveHours: true,
              reason: 'Servidor de jogo reiniciou (Fechamento Geral)'
            });
          } else {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, message: 'Ação inválida. Use "punch_in", "punch_out" ou "punch_out_all".' }));
            return;
          }

          // Enviar resposta estruturada
          res.writeHead(200);
          res.end(JSON.stringify(result));

        } catch (error) {
          logger.error('[API] Erro ao processar requisição de ponto:', error);
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, message: 'Requisição inválida (JSON corrompido ou malformado).' }));
        }
      });
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ success: false, message: 'Rota não encontrada. Use POST /api/duty.' }));
    }
  });

  server.listen(port, host, () => {
    logger.success(`[API] Servidor HTTP de Bate-Ponto rodando em http://${host}:${port}`);
  });

  server.on('error', (err) => {
    logger.error(`[API] Erro no servidor HTTP: ${err.message}`, err);
  });
}

module.exports = { startApiServer };
