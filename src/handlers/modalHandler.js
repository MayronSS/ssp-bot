const ticketsController = require('../modules/tickets/tickets.controller');
const editalController = require('../modules/edital/edital.controller');
const ausenciaController = require('../modules/ausencia/ausencia.controller');
const warningController = require('../modules/warning/warning.controller');
const avaliacaoController = require('../modules/avaliacao/avaliacao.controller');
const sugestoesController = require('../modules/sugestoes/sugestoes.controller');
const blacklistController = require('../modules/blacklist/blacklist.controller');
const solicitacoesController = require('../modules/solicitacoes/solicitacoes.controller');
const exoneracoesController = require('../modules/exoneracoes/exoneracoes.controller');
const transferenciasController = require('../modules/transferencias/transferencias.controller');
const logger = require('../utils/logger');
const { EPHEMERAL_REPLY } = require('../utils/interactionOptions');

function isUnknownInteraction(error) {
  return error?.code === 10062 || /Unknown interaction/i.test(error?.message || '');
}

/**
 * Handler de modals.
 * Roteia a submissão de formulários modais aos controllers corretos.
 */
async function modalHandler(interaction) {
  const { customId } = interaction;

  try {
    // Roteamento de Tickets
    if (customId === 'modal_add_membro') {
      return await ticketsController.handleAddMemberModal(interaction);
    }
    if (customId.startsWith('registro_update_name_modal:')) {
      return await ticketsController.handleRegistrationNameModal(interaction);
    }
    if (customId.startsWith('registro_update_patente_modal:')) {
      return await ticketsController.handleRegistrationPatenteModal(interaction);
    }
    if (customId.startsWith('registro_update_badge_modal:')) {
      return await ticketsController.handleRegistrationBadgeModal(interaction);
    }
    if (customId.startsWith('registro_update_outro_modal:')) {
      return await ticketsController.handleRegistrationOutroModal(interaction);
    }
    if (customId.startsWith('corr_case_modal:')) {
      return await ticketsController.handleCorregedoriaCaseModal(interaction);
    }
    if (customId === 'corr_case_manual_modal') {
      return await ticketsController.handleCorregedoriaManualModal(interaction);
    }
    if (customId.startsWith('corr_apply_modal:')) {
      return await ticketsController.handleCorregedoriaApplyModal(interaction);
    }

    // Roteamento de Edital
    if (customId.startsWith('modal_registro_lspd')) {
      return await editalController.handleRegisterModal(interaction);
    }
    if (customId.startsWith('responder_')) {
      return await editalController.handleSaveAnswer(interaction);
    }
    if (customId.startsWith('edital_set_tags_modal:')) {
      return await editalController.handleSetTagsModalSubmit(interaction);
    }

    // Roteamento de Ausência
    if (customId === 'modal_solicitar_ausencia') {
      return await ausenciaController.handleModalSubmit(interaction);
    }
    if (customId.startsWith('modal_reprovar_ausencia_')) {
      return await ausenciaController.handleRejectModalSubmit(interaction);
    }

    // Roteamento de Advertência
    if (customId.startsWith('warning_reason_modal:')) {
      return await warningController.handleModalSubmit(interaction);
    }
    if (customId.startsWith('avaliacao_modal_')) {
      return await avaliacaoController.handleModalSubmit(interaction);
    }

    // Roteamento de Academia
    if (customId === 'modal_academia_horario') {
      const academiaController = require('../modules/academia/academia.controller');
      return await academiaController.handleHorarioModal(interaction);
    }

    // Roteamento de Blacklist
    if (customId === 'blacklist_consultar_modal') {
      return await blacklistController.handleConsultarModalSubmit(interaction);
    }
    if (customId === 'blacklist_adicionar_modal') {
      return await blacklistController.handleAdicionarModalSubmit(interaction);
    }

    // Roteamento de Solicitações Internas
    if (customId === 'solicitacao_interna_modal') {
      return await solicitacoesController.handleSolicitacaoModalSubmit(interaction);
    }

    // Roteamento de Exonerações
    if (customId === 'exoneracao_modal_submit') {
      return await exoneracoesController.handleExoneracaoModalSubmit(interaction);
    }

    // Roteamento de Transferências
    if (customId.startsWith('transferencia_modal_justificativa:')) {
      return await transferenciasController.handleTransferenciaModalSubmit(interaction);
    }

    logger.warn(`Modal não mapeado: ${customId}`);
  } catch (error) {
    if (isUnknownInteraction(error)) {
      logger.warn(`Modal ${customId} ignorado: interacao expirada ou ja respondida por outra instancia.`);
      return;
    }

    logger.error(`Erro ao processar modal ${customId}:`, error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Ocorreu um erro ao processar o formulário.',
        ...EPHEMERAL_REPLY,
      }).catch(() => {});
    }
  }
}

module.exports = modalHandler;
