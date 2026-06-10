const ticketsController = require('../modules/tickets/tickets.controller');
const editalController = require('../modules/edital/edital.controller');
const warningController = require('../modules/warning/warning.controller');
const avaliacaoController = require('../modules/avaliacao/avaliacao.controller');
const logger = require('../utils/logger');
const { EPHEMERAL_REPLY, withEphemeral } = require('../utils/interactionOptions');
const corporationsConfig = require('../config/corporations');
const corporationService = require('../services/corporationService');
const componentFactory = require('../utils/componentFactory');
const { MessageFlags } = require('discord.js');

const validSlugs = corporationsConfig.allSlugs;

function extractCorpSlug(customId) {
  const lastColon = customId.lastIndexOf(':');
  if (lastColon === -1) return null;
  const candidate = customId.substring(lastColon + 1);
  return validSlugs.includes(candidate) ? candidate : null;
}

function baseId(customId) {
  const slug = extractCorpSlug(customId);
  if (!slug) return customId;
  return customId.substring(0, customId.lastIndexOf(':'));
}

function isUnknownInteraction(error) {
  return error?.code === 10062 || /Unknown interaction/i.test(error?.message || '');
}

/**
 * Handler de select menus.
 * Roteia as interações de menus suspensos para os controllers corretos.
 * Inclui rotas para seleção de corporação nos painéis unificados.
 */
async function selectMenuHandler(interaction) {
  const { customId } = interaction;
  const corpSlug = extractCorpSlug(customId) || 'pmesp';
  const base = baseId(customId);

  try {
    // ==========================================
    // SELECT DE CORPORAÇÃO (Painel Unificado de Tickets)
    // Quando o membro seleciona PMESP ou PCESP, mostra select de departamento
    // ==========================================
    if (customId === 'selecionar_corp_ticket') {
      const selectedCorpSlug = interaction.values[0];
      const corporation = await corporationService.getBySlug(interaction.guildId, selectedCorpSlug);
      if (!corporation) {
        return interaction.reply({
          content: '❌ Corporação não encontrada. Execute `/setup-patentes` primeiro.',
          ...EPHEMERAL_REPLY,
        });
      }

      // Mostrar o menu de departamentos da corporação selecionada
      const payload = componentFactory.createTicketPanelPayload(corporation);
      return interaction.reply(withEphemeral(payload));
    }

    // ==========================================
    // SELECT DE CORPORAÇÃO (Painel Unificado de Edital)
    // Quando o membro seleciona PMESP ou PCESP, inicia candidatura
    // ==========================================
    if (customId === 'selecionar_corp_edital') {
      const selectedCorpSlug = interaction.values[0];
      return await editalController.handleStart(interaction, selectedCorpSlug);
    }

    // ==========================================
    // SELECT DE CORPORAÇÃO GENÉRICO (corpResolver)
    // Quando o membro tem 2+ corporações e precisa escolher para uma ação
    // ==========================================
    if (customId === 'corp_select_action') {
      const selectedValue = interaction.values[0]; // ex: "ponto_bater:pmesp"
      const lastColon = selectedValue.lastIndexOf(':');
      if (lastColon === -1) {
        return interaction.reply({ content: '❌ Ação inválida.', ...EPHEMERAL_REPLY });
      }
      const actionBase = selectedValue.substring(0, lastColon);
      const actionCorpSlug = selectedValue.substring(lastColon + 1);

      // Re-emitir a interação como se fosse um botão com o sufixo de corporação
      // Simular chamando o buttonHandler diretamente
      const buttonHandler = require('./buttonHandler');
      // Criar um proxy da interação com o customId correto
      const proxyInteraction = Object.create(interaction);
      proxyInteraction.customId = selectedValue;
      proxyInteraction.replied = false;
      proxyInteraction.deferred = false;
      // Sobrescrever reply/deferReply para usar a interação real via update
      proxyInteraction.reply = async (data) => {
        if (interaction.replied || interaction.deferred) {
          return interaction.followUp(data);
        }
        return interaction.reply(data);
      };
      proxyInteraction.deferReply = async (opts) => {
        if (interaction.replied || interaction.deferred) return;
        return interaction.deferReply(opts);
      };
      proxyInteraction.editReply = async (data) => interaction.editReply(data);

      return await buttonHandler(proxyInteraction);
    }

    // ==========================================
    // ROTEAMENTO DE TICKETS
    // ==========================================
    if (base === 'selecionar_tipo_ticket') {
      return await ticketsController.handleSelectType(interaction, corpSlug);
    }
    if (customId.startsWith('registro_update_select:')) {
      return await ticketsController.handleRegistrationUpdateSelect(interaction);
    }
    if (base === 'corr_rank_select') {
      return await ticketsController.handleCorregedoriaRankSelect(interaction);
    }
    if (customId.startsWith('corr_officer_select:')) {
      return await ticketsController.handleCorregedoriaOfficerSelect(interaction);
    }

    // ==========================================
    // ROTEAMENTO DE ADVERTÊNCIA
    // ==========================================
    if (base === 'warning_rank_select') {
      return await warningController.handleRankSelect(interaction);
    }
    if (customId.startsWith('warning_officer_select:')) {
      return await warningController.handleOfficerSelect(interaction);
    }
    if (customId.startsWith('warning_level_select:') || customId.startsWith('warning_duration_select:')) {
      return await warningController.handleConfigSelect(interaction);
    }

    // ==========================================
    // ROTEAMENTO DE EDITAL
    // ==========================================
    if (base === 'selecionar_pergunta_lspd') {
      return await editalController.handleSelectQuestion(interaction);
    }

    // ==========================================
    // ROTEAMENTO DE AVALIAÇÃO
    // ==========================================
    if (base === 'avaliacao_rank_select') {
      return await avaliacaoController.handleRankSelect(interaction);
    }
    if (customId.startsWith('avaliacao_officer_select:')) {
      return await avaliacaoController.handleOfficerSelect(interaction);
    }

    // ==========================================
    // ROTEAMENTO DE ACADEMIA
    // ==========================================
    if (customId.startsWith('academia_select_curso:')) {
      const academiaController = require('../modules/academia/academia.controller');
      return await academiaController.handleSelectCurso(interaction);
    }

    // ==========================================
    // ROTEAMENTO DE TRANSFERÊNCIAS
    // ==========================================
    if (customId === 'transferencia_select_destino') {
      const transferenciasController = require('../modules/transferencias/transferencias.controller');
      return await transferenciasController.handleTransferenciaSelectDestino(interaction);
    }

    logger.warn(`Select menu não mapeado: ${customId}`);
  } catch (error) {
    if (isUnknownInteraction(error)) {
      logger.warn(`Select menu ${customId} ignorado: interacao expirada ou ja respondida por outra instancia.`);
      return;
    }

    logger.error(`Erro ao processar select menu ${customId}:`, error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Ocorreu um erro ao processar a seleção.',
        ...EPHEMERAL_REPLY,
      }).catch(() => {});
    }
  }
}

module.exports = selectMenuHandler;

