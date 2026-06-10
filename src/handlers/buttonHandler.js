const ticketsController = require('../modules/tickets/tickets.controller');
const editalController = require('../modules/edital/edital.controller');
const pontoController = require('../modules/ponto/ponto.controller');
const ausenciaController = require('../modules/ausencia/ausencia.controller');
const warningController = require('../modules/warning/warning.controller');
const avaliacaoController = require('../modules/avaliacao/avaliacao.controller');
const sugestoesController = require('../modules/sugestoes/sugestoes.controller');
const blacklistController = require('../modules/blacklist/blacklist.controller');
const solicitacoesController = require('../modules/solicitacoes/solicitacoes.controller');
const exoneracoesController = require('../modules/exoneracoes/exoneracoes.controller');
const transferenciasController = require('../modules/transferencias/transferencias.controller');
const configService = require('../services/configService');
const corporationService = require('../services/corporationService');
const { canSetupPanels } = require('../services/permissionService');
const { createSuccessEmbed } = require('../utils/createEmbed');
const logger = require('../utils/logger');
const { EPHEMERAL_REPLY } = require('../utils/interactionOptions');
const corporationsConfig = require('../config/corporations');
const { resolveCorpFromMember } = require('../utils/corpResolver');

// ═══════════════════════════════════════
// HELPER: Extrair corpSlug do customId
// ═══════════════════════════════════════
const validSlugs = corporationsConfig.allSlugs;

/**
 * Extrai o slug da corporação de um customId.
 * Ex: "ponto_bater:pmesp" → "pmesp"
 *     "ponto_bater" → null (compatibilidade)
 */
function extractCorpSlug(customId) {
  const lastColon = customId.lastIndexOf(':');
  if (lastColon === -1) return null;
  const candidate = customId.substring(lastColon + 1);
  return validSlugs.includes(candidate) ? candidate : null;
}

/**
 * Remove o sufixo de corporação do customId para obter o comando base.
 * Ex: "ponto_bater:pmesp" → "ponto_bater"
 *     "ponto_bater" → "ponto_bater"
 */
function baseId(customId) {
  const slug = extractCorpSlug(customId);
  if (!slug) return customId;
  return customId.substring(0, customId.lastIndexOf(':'));
}

/**
 * Resolve a corporação para a interação.
 * Se o customId tem sufixo, usa direto. Senão, detecta pelo cargo do membro.
 * Retorna null se não conseguiu resolver (já enviou resposta ao membro).
 */
async function resolveCorpSlug(interaction, base) {
  const slug = extractCorpSlug(interaction.customId);
  if (slug) return slug;

  // Auto-detecção: tentar resolver pelo cargo do membro
  const resolved = await resolveCorpFromMember(interaction, null, base);
  return resolved; // null se não resolveu (já respondeu ao membro)
}

/**
 * Handler de botões.
 * Roteia as interações de botão para os controllers correspondentes.
 * CustomIds com sufixo :slug são resolvidos para a corporação correta.
 * CustomIds sem sufixo: auto-detectam corporação pelo cargo do membro.
 */
async function buttonHandler(interaction) {
  const { customId } = interaction;
  const base = baseId(customId);

  try {
    // ==========================================
    // ROTEAMENTO DE TICKETS
    // ==========================================
    if (base === 'ticket_abrir' || base.startsWith('ticket_abrir_')) {
      const corpSlug = extractCorpSlug(customId) || 'pmesp';
      return await ticketsController.handleOpenTicketByButton(interaction, corpSlug);
    }
    if (base === 'ticket_assumir') {
      return await ticketsController.handleClaim(interaction);
    }
    if (base === 'ticket_espera') {
      return await ticketsController.handleHold(interaction);
    }
    if (base === 'ticket_add_member') {
      return await ticketsController.handleAddMemberButton(interaction);
    }
    if (base === 'ticket_fechar' || base === 'ticket_close') {
      return await ticketsController.handleClose(interaction);
    }
    if (base === 'ticket_call') {
      return await ticketsController.handleRadioCall(interaction);
    }
    if (base === 'ticket_corregedoria_start') {
      return await ticketsController.handleCorregedoriaStart(interaction);
    }
    if (customId.startsWith('ticket_ping_')) {
      return await ticketsController.handlePing(interaction);
    }
    if (base === 'corr_manual_officer') {
      return await ticketsController.handleCorregedoriaManualButton(interaction);
    }
    if (customId.startsWith('corr_vote_')) {
      return await ticketsController.handleCorregedoriaVote(interaction);
    }
    if (customId.startsWith('corr_duration_')) {
      return await ticketsController.handleCorregedoriaDurationVote(interaction);
    }
    if (base === 'corr_apply_result') {
      return await ticketsController.handleCorregedoriaApplyButton(interaction);
    }

    // ==========================================
    // ROTEAMENTO DE EDITAL
    // ==========================================
    if (base === 'edital_iniciar' || base === 'iniciar_edital_lspd') {
      const corpSlug = extractCorpSlug(customId) || 'pmesp';
      return await editalController.handleStart(interaction, corpSlug);
    }
    if (base === 'edital_cancelar') {
      return await editalController.handleCancel(interaction);
    }
    if (base === 'edital_requisitos') {
      const corpSlug = extractCorpSlug(customId) || 'pmesp';
      return await editalController.handleRequirements(interaction, corpSlug);
    }
    if (base === 'finalizar_envio_lspd') {
      return await editalController.handleSend(interaction);
    }
    if (customId.startsWith('aprovar_edital_')) {
      return await editalController.handleApprove(interaction);
    }
    if (customId.startsWith('reprovar_edital_')) {
      return await editalController.handleReject(interaction);
    }
    if (customId.startsWith('confirmar_dados_')) {
      return await editalController.handleClaimBadge(interaction);
    }
    if (customId.startsWith('edital_setar_tags_')) {
      return await editalController.handleSetTags(interaction);
    }

    // ==========================================
    // ROTEAMENTO DE PONTO (auto-detecção de corp)
    // ==========================================
    if (base === 'ponto_bater' || base === 'registrar_entrada_lspd') {
      const corpSlug = await resolveCorpSlug(interaction, 'ponto_bater');
      if (!corpSlug) return;
      return await pontoController.handleEntrada(interaction, corpSlug);
    }
    if (base === 'ponto_encerrar' || base === 'registrar_saida_lspd') {
      const corpSlug = await resolveCorpSlug(interaction, 'ponto_encerrar');
      if (!corpSlug) return;
      return await pontoController.handleSaida(interaction, corpSlug);
    }
    if (base === 'ponto_atualizar' || base === 'atualizar_status_lspd') {
      const corpSlug = await resolveCorpSlug(interaction, 'ponto_atualizar');
      if (!corpSlug) return;
      return await pontoController.handleRefresh(interaction, corpSlug);
    }
    if (base === 'ponto_ranking' || base === 'ver_ranking_lspd') {
      const corpSlug = await resolveCorpSlug(interaction, 'ponto_ranking');
      if (!corpSlug) return;
      return await pontoController.handleVerRanking(interaction, corpSlug);
    }

    // ==========================================
    // ROTEAMENTO DE AUSÊNCIA (auto-detecção de corp)
    // ==========================================
    if (base === 'ausencia_solicitar') {
      const corpSlug = await resolveCorpSlug(interaction, 'ausencia_solicitar');
      if (!corpSlug) return;
      return await ausenciaController.handleSolicitarButton(interaction, corpSlug);
    }
    if (customId.startsWith('ausencia_aprovar_')) {
      return await ausenciaController.handleApproveButton(interaction);
    }
    if (customId.startsWith('ausencia_reprovar_')) {
      return await ausenciaController.handleRejectButton(interaction);
    }

    // ==========================================
    // ROTEAMENTO DE ADVERTÊNCIA (auto-detecção de corp)
    // ==========================================
    if (base === 'warning_aplicar') {
      const corpSlug = await resolveCorpSlug(interaction, 'warning_aplicar');
      if (!corpSlug) return;
      return await warningController.handleWarningStart(interaction, corpSlug);
    }
    if (customId.startsWith('warning_proceed_btn:')) {
      return await warningController.handleProceedButton(interaction);
    }

    // ==========================================
    // ROTEAMENTO DE AVALIAÇÃO (auto-detecção de corp)
    // ==========================================
    if (base === 'avaliacao_iniciar') {
      const corpSlug = await resolveCorpSlug(interaction, 'avaliacao_iniciar');
      if (!corpSlug) return;
      return await avaliacaoController.handleStart(interaction, corpSlug);
    }

    // ==========================================
    // ROTEAMENTO DE CONFIGURAÇÕES / ADMINISTRAÇÃO
    // ==========================================
    if (base === 'config_reload') {
      if (!await canSetupPanels(interaction.member)) {
        return interaction.reply({
          content: '❌ Apenas membros do Comando e Administradores podem recarregar as configurações.',
          ...EPHEMERAL_REPLY,
        });
      }
      await interaction.deferReply(EPHEMERAL_REPLY);
      await configService.reloadConfig(interaction.guildId);
      corporationService.invalidateCache(interaction.guildId);
      return await interaction.editReply({
        embeds: [createSuccessEmbed('Configurações Atualizadas', 'As configurações e cache do servidor foram recarregadas com sucesso do Banco de Dados!')],
      });
    }

    // ==========================================
    // ROTEAMENTO DE SUGESTÕES
    // ==========================================
    if (base === 'sugestao_enviar') {
      return interaction.reply({
        content: '💡 O painel de sugestões foi atualizado! Agora basta você digitar sua sugestão diretamente neste canal para abri-la para votação.',
        ...EPHEMERAL_REPLY
      });
    }
    if (customId.startsWith('sugestao_voto_up:') || customId.startsWith('sugestao_voto_down:')) {
      return await sugestoesController.handleSugestaoVote(interaction);
    }

    // ==========================================
    // ROTEAMENTO DE BLACKLIST
    // ==========================================
    if (base === 'blacklist_consultar_btn') {
      return await blacklistController.handleConsultarBlacklistButton(interaction);
    }
    if (base === 'blacklist_adicionar_btn') {
      return await blacklistController.handleAdicionarBlacklistButton(interaction);
    }

    // ==========================================
    // ROTEAMENTO DE SOLICITAÇÕES INTERNAS
    // ==========================================
    if (base === 'solicitacao_interna_btn') {
      return await solicitacoesController.handleEnviarSolicitacaoButton(interaction);
    }
    if (customId.startsWith('solicitacao_interna_aprovar:') || customId.startsWith('solicitacao_interna_reprovar:')) {
      return await solicitacoesController.handleSolicitacaoDecide(interaction);
    }

    // ==========================================
    // ROTEAMENTO DE EXONERAÇÕES
    // ==========================================
    if (base === 'exoneracao_solicitar' || base === 'exoneracao_registrar_btn') {
      return await exoneracoesController.handleExoneracaoButton(interaction);
    }
    if (customId.startsWith('exoneracao_aprovar:') || customId.startsWith('exoneracao_reprovar:')) {
      return await exoneracoesController.handleExoneracaoDecide(interaction);
    }

    // ==========================================
    // ROTEAMENTO DE TRANSFERÊNCIAS
    // ==========================================
    if (base === 'transferencia_solicitar') {
      return await transferenciasController.handleTransferenciaButton(interaction);
    }
    if (customId.startsWith('transferencia_aprovar:') || customId.startsWith('transferencia_reprovar:')) {
      return await transferenciasController.handleTransferenciaDecide(interaction);
    }

    // ==========================================
    // ROTEAMENTO DE ACADEMIA
    // ==========================================
    if (base === 'academia_acessar') {
      const corpSlug = await resolveCorpSlug(interaction, 'academia_acessar');
      if (!corpSlug) return;
      const academiaController = require('../modules/academia/academia.controller');
      return await academiaController.handleAccessAcademia(interaction, corpSlug);
    }
    if (base === 'academia_meus_cursos') {
      const corpSlug = await resolveCorpSlug(interaction, 'academia_meus_cursos');
      if (!corpSlug) return;
      const academiaController = require('../modules/academia/academia.controller');
      return await academiaController.handleMeusCursos(interaction, corpSlug);
    }
    if (customId.startsWith('academia_candidatar:')) {
      const academiaController = require('../modules/academia/academia.controller');
      return await academiaController.handleCandidatar(interaction);
    }
    if (customId.startsWith('academia_lista:')) {
      const academiaController = require('../modules/academia/academia.controller');
      return await academiaController.handleListaInscritos(interaction);
    }
    if (customId.startsWith('academia_encerrar:')) {
      const academiaController = require('../modules/academia/academia.controller');
      return await academiaController.handleEncerrarAula(interaction);
    }

    logger.warn(`Botão não mapeado: ${customId}`);
  } catch (error) {
    logger.error(`Erro ao processar botão ${customId}:`, error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Ocorreu um erro ao processar esta ação.',
        ...EPHEMERAL_REPLY,
      }).catch(() => {});
    }
  }
}

module.exports = buttonHandler;

