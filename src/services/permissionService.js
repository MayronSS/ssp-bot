const configService = require('./configService');
const corporationService = require('./corporationService');

/**
 * Serviço centralizado de permissões.
 * Busca cargos tanto no GuildConfig legado quanto nas corporações do corporationService.
 */

/**
 * Verifica se o membro possui pelo menos um dos cargos configurados.
 */
function hasAnyRole(member, roleIds) {
  if (!member || !roleIds) return false;
  const validRoles = roleIds.filter(Boolean);
  if (validRoles.length === 0) return false;
  return member.roles.cache.some((role) => validRoles.includes(role.id));
}

/**
 * Coleta os IDs de cargos de sistema de TODAS as corporações primárias.
 * Exemplo: retorna todos os 'comando' roleIds de PMESP + PCESP.
 */
async function getAllCorpRoles(guildId, roleKey) {
  const corps = await corporationService.listPrimary(guildId);
  return corps
    .map(c => c.roles?.[roleKey])
    .filter(Boolean);
}

/**
 * Verifica se o membro possui o cargo 'geral' de qualquer corporação.
 */
async function isMemberOfAnyCorp(member) {
  if (!member) return false;
  const corps = await corporationService.listPrimary(member.guild.id);
  return corps.some(c => c.roles?.geral && member.roles.cache.has(c.roles.geral));
}

/**
 * Verifica se o membro pode gerenciar tickets.
 * Fallback: Administrador, Gerenciar Canais, ou cargos com nomes comuns de Staff/Suporte/Comando.
 */
async function canManageTickets(member) {
  if (!member) return false;
  if (member.permissions.has('Administrator') || member.permissions.has('ManageChannels')) return true;

  const guildId = member.guild.id;

  // Cargos do GuildConfig legado
  const ticketStaffRole = await configService.getRole(guildId, 'ticketStaff');
  const commandRole = await configService.getRole(guildId, 'comandoAdmin');
  const administrativoRole = await configService.getRole(guildId, 'administrativo');

  if (hasAnyRole(member, [ticketStaffRole, commandRole, administrativoRole])) return true;

  // Cargos do corporationService (comando e staff de todas as corps)
  const corpComandoRoles = await getAllCorpRoles(guildId, 'comando');
  const corpStaffRoles = await getAllCorpRoles(guildId, 'staff');
  const corpAdminRoles = await getAllCorpRoles(guildId, 'administrativo');
  if (hasAnyRole(member, [...corpComandoRoles, ...corpStaffRoles, ...corpAdminRoles])) return true;

  // Busca por nome de cargo caso não haja IDs válidos configurados
  return member.roles.cache.some(r =>
    ['staff', 'suporte', 'equipe', 'comando', 'administracao', 'ticket staff', 'administrativo'].some(name =>
      r.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(name)
    )
  );
}

/**
 * Verifica se o membro pode executar comandos de setup.
 * Restrito exclusivamente ao ID autorizado: 896063696567152671
 */
async function canSetupPanels(member) {
  if (!member) return false;
  const allowedUser = process.env.SETUP_ALLOWED_USER_ID || '896063696567152671';
  return member.id === allowedUser;
}

/**
 * Verifica se o membro pode gerenciar registros de bate-ponto.
 */
async function canManagePonto(member) {
  if (!member) return false;
  if (member.permissions.has('Administrator') || member.permissions.has('ManageGuild')) return true;

  const guildId = member.guild.id;
  const setupRole = await configService.getRole(guildId, 'setupAuthorized');
  const commandRole = await configService.getRole(guildId, 'comandoAdmin');
  const administrativoRole = await configService.getRole(guildId, 'administrativo');

  if (hasAnyRole(member, [setupRole, commandRole, administrativoRole])) return true;

  // Cargos do corporationService
  const corpComandoRoles = await getAllCorpRoles(guildId, 'comando');
  const corpStaffRoles = await getAllCorpRoles(guildId, 'staff');
  if (hasAnyRole(member, [...corpComandoRoles, ...corpStaffRoles])) return true;

  return member.roles.cache.some(r =>
    ['comando', 'direcao', 'alto comando', 'staff', 'administracao', 'supervisor', 'administrativo'].some(name =>
      r.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(name)
    )
  );
}

/**
 * Verifica se o membro pode abrir ticket de atualização de registro.
 * Aceita qualquer oficial vinculado a qualquer corporação.
 */
async function canOpenRegistrationUpdate(member) {
  if (!member) return false;

  const guildId = member.guild.id;

  // Legado
  const policialRole = await configService.getRole(guildId, 'policial');
  const lspdRole = await configService.getRole(guildId, 'lspdGeral');
  if (hasAnyRole(member, [policialRole, lspdRole])) return true;

  // Corporação: membro de qualquer corp
  return await isMemberOfAnyCorp(member);
}

/**
 * Verifica se o membro pode solicitar ausência.
 * Permitido para oficiais de qualquer corporação.
 */
async function canRequestAbsence(member) {
  if (!member) return false;

  const guildId = member.guild.id;
  const policialRole = await configService.getRole(guildId, 'policial');
  const lspdRole = await configService.getRole(guildId, 'lspdGeral');

  if (hasAnyRole(member, [policialRole, lspdRole])) return true;

  // Corporação: membro de qualquer corp
  if (await isMemberOfAnyCorp(member)) return true;

  // Busca por nome de cargo
  return member.roles.cache.some(r =>
    ['policial', 'pmesp', 'pcesp', 'recruta', 'cadete', 'membro', 'agente'].some(name =>
      r.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(name)
    )
  );
}

/**
 * Verifica se o membro pode aplicar advertências diretas.
 * Permitido para Comando, Staff ou Corregedoria de qualquer corporação.
 */
async function canApplyWarnings(member) {
  if (!member) return false;
  if (member.permissions.has('Administrator')) return true;

  const guildId = member.guild.id;
  const commandRole = await configService.getRole(guildId, 'comandoAdmin');
  const setupRole = await configService.getRole(guildId, 'setupAuthorized');
  const ticketStaffRole = await configService.getRole(guildId, 'ticketStaff');
  const administrativoRole = await configService.getRole(guildId, 'administrativo');

  if (hasAnyRole(member, [commandRole, setupRole, ticketStaffRole, administrativoRole])) return true;

  // Cargos do corporationService
  const corpComandoRoles = await getAllCorpRoles(guildId, 'comando');
  const corpStaffRoles = await getAllCorpRoles(guildId, 'staff');
  if (hasAnyRole(member, [...corpComandoRoles, ...corpStaffRoles])) return true;

  return member.roles.cache.some(r =>
    ['comando', 'direcao', 'alto comando', 'staff', 'corregedoria', 'corregedor', 'administracao', 'administrativo'].some(name =>
      r.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(name)
    )
  );
}

/**
 * Verifica se o membro é Cabo ou acima para poder avaliar oficiais.
 */
async function canEvaluate(member) {
  if (!member) return false;
  if (member.permissions.has('Administrator')) return true;

  const guildId = member.guild.id;
  const caboRoleId = await configService.getRole(guildId, 'caboRole');
  if (caboRoleId) {
    const caboRole = member.guild.roles.cache.get(caboRoleId);
    if (caboRole) {
      return member.roles.cache.some(r => r.position >= caboRole.position);
    }
  }

  // Fallback: nomes de cargos
  const allowedRanks = [
    'cabo', 'sargento', 'subtenente', 'tenente', 'capitao', 'major', 'tenente-coronel', 'coronel',
    'alto comando', 'comando', 'setup autorizado', 'staff de tickets', 'administrativo', 'direcao', 'administracao',
    'delegado', 'investigador', 'escrivao', 'perito'
  ];

  return member.roles.cache.some(r => {
    const normalized = r.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return allowedRanks.some(rank => normalized.includes(rank));
  });
}

/**
 * Verifica se o membro pode acessar o painel da academia (como ministrador).
 */
async function canAccessAcademia(member) {
  if (!member) return false;
  if (member.permissions.has('Administrator')) return true;

  const guildId = member.guild.id;

  // GuildConfig legado
  const ministradorRole = await configService.getRole(guildId, 'ministrador');
  if (ministradorRole && member.roles.cache.has(ministradorRole)) return true;

  // Cargos do corporationService (ministrador de todas as corps)
  const corpMinistradorRoles = await getAllCorpRoles(guildId, 'ministrador');
  if (hasAnyRole(member, corpMinistradorRoles)) return true;

  // Fallback por nome
  return member.roles.cache.some(r =>
    ['ministrador', 'instrutor', 'professor', 'academia'].some(name =>
      r.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(name)
    )
  );
}

module.exports = {
  hasAnyRole,
  canManageTickets,
  canSetupPanels,
  canManagePonto,
  canOpenRegistrationUpdate,
  canRequestAbsence,
  canApplyWarnings,
  canEvaluate,
  canAccessAcademia,
};
