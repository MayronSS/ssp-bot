const { StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Transferencia = require('../../database/models/Transferencia');
const Corporation = require('../../database/models/Corporation');
const componentFactory = require('../../utils/componentFactory');
const emojiHelper = require('../../utils/emojiHelper');
const logger = require('../../utils/logger');
const logService = require('../../services/logService');
const { canSetupPanels } = require('../../services/permissionService');
const { EPHEMERAL_REPLY } = require('../../utils/interactionOptions');

const ALTO_COMANDO_TRANSFERENCIAS_LOG_CHANNEL_ID = '1510994173229269052';

const DESTINATIONS = {
  pmesp: 'PMESP - Polícia Militar',
  pcesp: 'PCESP - Polícia Civil',
  rota: 'ROTA (Batalhão Especializado)',
  baep: 'BAEP (Batalhão Especializado)',
  bprv: 'BPRV (Batalhão Rodoviário)',
  cavpm: 'CAVPM (Cavalaria)',
};

async function handleTransferenciaButton(interaction) {
  // Detectar atual
  const affiliation = logService.resolveMemberAffiliation(interaction.member);
  const currentLabel = affiliation.battalion 
    ? `${affiliation.battalion}` 
    : (affiliation.corporation ? `${affiliation.corporation}` : 'PMESP sem batalhão');

  const selectOptions = Object.entries(DESTINATIONS).map(([slug, label]) => ({
    label,
    value: slug,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('transferencia_select_destino')
    .setPlaceholder('Escolha o seu destino...')
    .addOptions(selectOptions);

  await interaction.reply({
    content: `Olá! Detectamos que você atualmente pertence a: **${currentLabel}**.\n\nSelecione para qual divisão ou corporação deseja solicitar sua transferência:`,
    components: [new ActionRowBuilder().addComponents(select)],
    ...EPHEMERAL_REPLY,
  });
}

async function handleTransferenciaSelectDestino(interaction) {
  const selectedDestination = interaction.values[0];
  const destLabel = DESTINATIONS[selectedDestination] || selectedDestination.toUpperCase();

  const modal = new ModalBuilder()
    .setCustomId(`transferencia_modal_justificativa:${selectedDestination}`)
    .setTitle('SSP — Solicitar Transferência');

  const motivoInput = new TextInputBuilder()
    .setCustomId('transferencia_motivo')
    .setLabel(`Justificativa para ir para ${destLabel.slice(0, 15)}:`)
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Descreva os motivos do seu pedido de transferência...')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(motivoInput));
  await interaction.showModal(modal);
}

async function handleTransferenciaModalSubmit(interaction) {
  await interaction.deferReply(EPHEMERAL_REPLY);

  const selectedDestination = interaction.customId.split(':')[1];
  const motivo = interaction.fields.getTextInputValue('transferencia_motivo').trim();

  // Detectar atual automaticamente
  const affiliation = logService.resolveMemberAffiliation(interaction.member);
  const currentLabel = affiliation.battalion 
    ? `${affiliation.battalion}` 
    : (affiliation.corporation ? `${affiliation.corporation}` : 'PMESP sem batalhão');

  try {
    const destLabel = DESTINATIONS[selectedDestination] || selectedDestination.toUpperCase();

    const transferencia = await Transferencia.create({
      guildId: interaction.guildId,
      messageId: 'PENDING_' + Date.now(),
      userId: interaction.user.id,
      destino: destLabel,
      motivo,
      status: 'pending',
    });

    const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 256 }) || null;
    const payload = componentFactory.createTransferenciaCardPayload({
      ...transferencia.toObject(),
      currentLabel,
    }, avatarUrl);

    // Enviar para o Alto Comando log channel (1510994173229269052)
    const targetChannel = interaction.guild.channels.cache.get(ALTO_COMANDO_TRANSFERENCIAS_LOG_CHANNEL_ID) ||
      await interaction.guild.channels.fetch(ALTO_COMANDO_TRANSFERENCIAS_LOG_CHANNEL_ID).catch(() => null) ||
      interaction.channel;

    const cardMessage = await targetChannel.send(payload);

    transferencia.messageId = cardMessage.id;
    await transferencia.save();

    await interaction.editReply({
      content: `${emojiHelper.get('check')} Sua solicitação de transferência para **${destLabel}** foi enviada ao Alto Comando com sucesso!`,
      components: [],
    });
  } catch (error) {
    logger.error('Erro ao registrar solicitação de transferência:', error);
    await interaction.editReply({
      content: `${emojiHelper.get('stop')} Ocorreu um erro ao processar o seu formulário.`,
      components: [],
    });
  }
}

async function handleTransferenciaDecide(interaction) {
  const [action, transferenciaId] = interaction.customId.split(':');
  const isApprove = action === 'transferencia_aprovar';

  // Apenas Comando/Administradores
  if (!await canSetupPanels(interaction.member)) {
    return interaction.reply({
      content: `${emojiHelper.get('stop')} **Acesso Negado:** Apenas o Comando/Diretoria pode aprovar ou recusar transferências.`,
      ...EPHEMERAL_REPLY,
    });
  }

  try {
    const transferencia = await Transferencia.findById(transferenciaId);
    if (!transferencia) {
      return interaction.reply({
        content: `${emojiHelper.get('stop')} Solicitação de transferência não encontrada.`,
        ...EPHEMERAL_REPLY,
      });
    }

    transferencia.status = isApprove ? 'approved' : 'rejected';
    transferencia.resolvedBy = interaction.user.id; // Discord ID
    transferencia.resolvedAt = new Date();

    await transferencia.save();

    // Obter membro solicitante
    const requesterMember = await interaction.guild.members.fetch(transferencia.userId).catch(() => null);
    const avatarUrl = requesterMember?.user?.displayAvatarURL({ extension: 'png', size: 256 }) || null;

    // Se aprovado, atualizar cargos no Discord automaticamente
    if (isApprove && requesterMember) {
      // Slug destino correspondente
      let destSlug = null;
      for (const [slug, label] of Object.entries(DESTINATIONS)) {
        if (label === transferencia.destino) {
          destSlug = slug;
          break;
        }
      }

      if (destSlug) {
        // Encontrar as corporações / tags do banco
        const allCorps = await Corporation.find({ guildId: interaction.guildId });
        const rolesToRemove = [];
        let roleToAdd = null;

        for (const c of allCorps) {
          if (c.slug === destSlug && c.roles?.geral) {
            roleToAdd = c.roles.geral;
          } else if (c.roles?.geral) {
            // Se for ROTA, BAEP, BPRV, CAVPM ou PCESP, marcar para remover
            if (['rota', 'baep', 'bprv', 'cavpm', 'pcesp'].includes(c.slug)) {
              rolesToRemove.push(c.roles.geral);
            }
          }
        }

        // Se transferiu para PCESP, também remover Geral da PMESP
        if (destSlug === 'pcesp') {
          const pmesp = allCorps.find(c => c.slug === 'pmesp');
          if (pmesp?.roles?.geral) rolesToRemove.push(pmesp.roles.geral);
        } else if (['pmesp', 'rota', 'baep', 'bprv', 'cavpm'].includes(destSlug)) {
          // Se transferiu para PMESP ou seus batalhões, remover PCESP geral
          const pcesp = allCorps.find(c => c.slug === 'pcesp');
          if (pcesp?.roles?.geral) rolesToRemove.push(pcesp.roles.geral);

          // E se transferiu para batalhão, garantir que tem PMESP geral
          if (destSlug !== 'pmesp') {
            const pmesp = allCorps.find(c => c.slug === 'pmesp');
            if (pmesp?.roles?.geral) {
              await requesterMember.roles.add(pmesp.roles.geral).catch(() => null);
            }
          }
        }

        // Remover os cargos antigos
        const rolesToStrip = rolesToRemove.filter(rid => requesterMember.roles.cache.has(rid));
        if (rolesToStrip.length > 0) {
          await requesterMember.roles.remove(rolesToStrip, 'Transferência Efetuada').catch(() => null);
        }

        // Adicionar o cargo novo
        if (roleToAdd) {
          await requesterMember.roles.add(roleToAdd, 'Transferência Efetuada').catch(() => null);
        }
      }
    }

    // Detectar atual automaticamente (usando o valor persistido se possível ou resolver)
    let currentLabel = 'PMESP sem batalhão';
    if (requesterMember) {
      const origAff = logService.resolveMemberAffiliation(requesterMember);
      currentLabel = origAff.battalion || origAff.corporation || currentLabel;
    }

    // Atualizar mensagem
    const payload = componentFactory.createTransferenciaCardPayload({
      ...transferencia.toObject(),
      currentLabel,
    }, avatarUrl);

    await interaction.update(payload);
  } catch (error) {
    logger.error('Erro ao decidir transferência:', error);
    await interaction.reply({
      content: `${emojiHelper.get('stop')} Não foi possível atualizar o status da transferência.`,
      ...EPHEMERAL_REPLY,
    });
  }
}

module.exports = {
  handleTransferenciaButton,
  handleTransferenciaSelectDestino,
  handleTransferenciaModalSubmit,
  handleTransferenciaDecide,
};
