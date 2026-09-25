/**
 * Definição estática de todas as corporações, tags de batalhão e hierarquias.
 *
 * Para adicionar uma nova corporação ou subdivisão, basta editar este arquivo
 * e reiniciar o bot. O auto-seed no startup cria/atualiza tudo no MongoDB.
 *
 * Conceito:
 * - "primary"  → Corporação principal (PMESP, PCESP). Tem canais e hierarquia própria.
 * - "tag"      → Subdivisão/batalhão (FT, ROTA, BAEP, BPRV). Herda hierarquia da corp-mãe.
 *                O que diferencia é o cargo-tag no Discord + possíveis patentes exclusivas.
 */

module.exports = {
  // ═══════════════════════════════════════
  // CORPORAÇÕES PRINCIPAIS
  // ═══════════════════════════════════════
  corporations: [
    {
      slug: 'pmesp',
      name: 'Polícia Militar do Estado de São Paulo',
      shortName: 'PMESP',
      color: '#1B52F1',
      emoji: '🛡️',
      type: 'primary',

      // Hierarquia de patentes (level 0 = mais baixo)
      ranks: [
        { name: 'Soldado PM 2ª Classe', shortName: 'Sd 2ª', level: 0, emoji: '👮' },
        { name: 'Soldado PM 1ª Classe', shortName: 'Sd 1ª', level: 1, emoji: '👮' },
        { name: 'Cabo PM', shortName: 'Cb', level: 2, emoji: '🛡️' },
        { name: '3º Sargento PM', shortName: '3º Sgt', level: 3, emoji: '⚔️' },
        { name: '2º Sargento PM', shortName: '2º Sgt', level: 4, emoji: '⚔️' },
        { name: '1º Sargento PM', shortName: '1º Sgt', level: 5, emoji: '⚔️' },
        { name: 'Subtenente PM', shortName: 'Sub Ten', level: 6, emoji: '🎗️' },
        { name: '2º Tenente PM', shortName: '2º Ten', level: 7, emoji: '⭐' },
        { name: '1º Tenente PM', shortName: '1º Ten', level: 8, emoji: '⭐' },
        { name: 'Capitão PM', shortName: 'Cap', level: 9, emoji: '🎖️' },
        { name: 'Major PM', shortName: 'Maj', level: 10, emoji: '🥉' },
        { name: 'Tenente-Coronel PM', shortName: 'TC', level: 11, emoji: '🥈' },
        { name: 'Coronel PM', shortName: 'Cel', level: 12, emoji: '🎖️' },
        { name: 'CMD Geral Coronel PM', shortName: 'Cel', level: 13, emoji: '🥇' },
      ],

      // Cargos de sistema (nomes no Discord)
      systemRoles: {
        geral: '🛡️ ┃ PMESP',
        comando: '👑 ┃ Alto Comando PMESP',
        staff: '🎟️ ┃ Staff PMESP',
        administrativo: '⚖️ ┃ Administrativo PMESP',
        ministrador: '🎓 ┃ Ministrador PMESP',
        preAprovado: '📋 ┃ Pré-Aprovado PMESP',
        advVerbal: '💬 ┃ ADV Verbal PMESP',
        adv1: '⚠️ ┃ ADV 1 PMESP',
        adv2: '🚨 ┃ ADV 2 PMESP',
        adv3: '🛑 ┃ ADV 3 PMESP',
      },

      // Cursos de formação (cargos no Discord)
      courses: [
        { name: 'Curso de Modulação', roleName: '📚 ┃ Curso Modulação', color: '#1B52F1' },
        { name: 'Curso de Acompanhamento', roleName: '📚 ┃ Curso Acompanhamento', color: '#1B52F1' },
        { name: 'Curso de Abordagem', roleName: '📚 ┃ Curso Abordagem', color: '#1B52F1' },
        { name: 'Curso de Conduta', roleName: '📚 ┃ Curso Conduta', color: '#1B52F1' },
        { name: 'Curso de Disciplina', roleName: '📚 ┃ Curso Disciplina', color: '#1B52F1' },
      ],

      // Textos para embeds dinâmicos
      embedTexts: {
        orgName: 'POLÍCIA MILITAR DO ESTADO DE SÃO PAULO',
        ticketAuthor: 'PMESP • CENTRAL DE ATENDIMENTO',
        pontoAuthor: 'PMESP • REGISTRO DE EXPEDIENTE',
        editalAuthor: 'DIVISÃO DE RECRUTAMENTO • PMESP',
        ausenciaAuthor: 'PMESP • REGISTRO DE AUSÊNCIA',
        warningAuthor: 'PMESP • CENTRAL DE ADVERTÊNCIAS',
        avaliacaoAuthor: 'PMESP • CENTRAL DE AVALIAÇÕES',
        footer: 'PMESP • Sistema Oficial',
      },
    },
    {
      slug: 'pcesp',
      name: 'Polícia Civil do Estado de São Paulo',
      shortName: 'PCESP',
      color: '#C62828',
      emoji: '🛡️',
      type: 'primary',

      ranks: [
        { name: 'Agente Policial', shortName: 'Ag', level: 0, emoji: '🔰' },
        { name: 'Perito Criminal', shortName: 'Per', level: 1, emoji: '🔬' },
        { name: 'Escrivão de Polícia', shortName: 'Esc', level: 2, emoji: '📝' },
        { name: 'Escrivão Chefe', shortName: 'Esc Ch', level: 3, emoji: '📝' },
        { name: 'Investigador de Polícia', shortName: 'Inv', level: 4, emoji: '🔍' },
        { name: 'Investigador Chefe', shortName: 'Inv Ch', level: 5, emoji: '🔍' },
        { name: 'Delegado Titular', shortName: 'Del', level: 6, emoji: '⚖️' },
        { name: 'Delegado Seccional', shortName: 'Del Sec', level: 7, emoji: '🏛️' },
        { name: 'Delegado Geral de Polícia', shortName: 'Del Geral', level: 8, emoji: '🥇' },
      ],

      systemRoles: {
        geral: '🛡️ ┃ PCESP',
        comando: '👑 ┃ Alto Comando PCESP',
        staff: '🎟️ ┃ Staff PCESP',
        administrativo: '⚖️ ┃ Administrativo PCESP',
        ministrador: '🎓 ┃ Ministrador PCESP',
        preAprovado: '📋 ┃ Pré-Aprovado PCESP',
        advVerbal: '💬 ┃ ADV Verbal PCESP',
        adv1: '⚠️ ┃ ADV 1 PCESP',
        adv2: '🚨 ┃ ADV 2 PCESP',
        adv3: '🛑 ┃ ADV 3 PCESP',
      },

      // Cursos de formação (cargos no Discord)
      courses: [
        { name: 'Curso de Modulação', roleName: '📚 ┃ Curso Modulação PCESP', color: '#C62828' },
        { name: 'Curso de Acompanhamento', roleName: '📚 ┃ Curso Acompanhamento PCESP', color: '#C62828' },
        { name: 'Curso de Abordagem', roleName: '📚 ┃ Curso Abordagem PCESP', color: '#C62828' },
        { name: 'Curso de Conduta', roleName: '📚 ┃ Curso Conduta PCESP', color: '#C62828' },
        { name: 'Curso de Disciplina', roleName: '📚 ┃ Curso Disciplina PCESP', color: '#C62828' },
      ],

      embedTexts: {
        orgName: 'POLÍCIA CIVIL DO ESTADO DE SÃO PAULO',
        ticketAuthor: 'PCESP • CENTRAL DE ATENDIMENTO',
        pontoAuthor: 'PCESP • REGISTRO DE EXPEDIENTE',
        editalAuthor: 'DIVISÃO DE RECRUTAMENTO • PCESP',
        ausenciaAuthor: 'PCESP • REGISTRO DE AUSÊNCIA',
        warningAuthor: 'PCESP • CENTRAL DE ADVERTÊNCIAS',
        avaliacaoAuthor: 'PCESP • CENTRAL DE AVALIAÇÕES',
        footer: 'PCESP • Sistema Oficial',
      },
    },
  ],

  // ═══════════════════════════════════════
  // TAGS DE BATALHÃO (subdivisões da PMESP)
  // ═══════════════════════════════════════
  tags: [
    {
      slug: 'ft',
      name: 'Força Tática',
      shortName: 'FT',
      color: '#2E7D32',
      emoji: '⚡',
      inheritsFrom: 'pmesp',
      tagRole: '⚡ ┃ FT',
      rankOverrides: {
        remove: ['Soldado PM 2ª Classe', 'Soldado PM 1ª Classe', 'Coronel PM', 'CMD Geral Coronel PM'],
        add: [
          { name: 'Soldado da FT', shortName: 'Sd', level: 0, emoji: '👮' },
          { name: 'Coronel da FT', shortName: 'Cel', level: 13, emoji: '🥇' },
        ],
      },
    },
    {
      slug: 'rota',
      name: 'ROTA',
      shortName: 'ROTA',
      color: '#E65100',
      emoji: '🎯',
      inheritsFrom: 'pmesp',
      tagRole: '🎯 ┃ ROTA',
      rankOverrides: {
        remove: ['Soldado PM 2ª Classe', 'Soldado PM 1ª Classe'],
        add: [
          { name: 'Estagiário Boina Cinza', shortName: 'Est BC', level: 0, emoji: '🎓' },
          { name: 'Soldado', shortName: 'Sd', level: 1, emoji: '👮' },
        ],
      },
      exclusiveRanks: [
        { name: 'Estagiário Boina Cinza', roleName: '🎓 ┃ Estagiário Boina Cinza', color: '#E65100' },
      ],
    },
    {
      slug: 'baep',
      name: 'BAEP',
      shortName: 'BAEP',
      color: '#4A148C',
      emoji: '💥',
      inheritsFrom: 'pmesp',
      tagRole: '💥 ┃ BAEP',
      rankOverrides: {
        remove: ['Soldado PM 2ª Classe', 'Soldado PM 1ª Classe'],
        add: [
          { name: 'Soldado', shortName: 'Sd', level: 0, emoji: '👮' },
        ],
      },
    },
    {
      slug: 'bprv',
      name: 'BPRV',
      shortName: 'BPRV',
      color: '#01579B',
      emoji: '🛣️',
      inheritsFrom: 'pmesp',
      tagRole: '🛣️ ┃ BPRV',
      rankOverrides: {
        remove: ['Soldado PM 2ª Classe', 'Soldado PM 1ª Classe'],
        add: [
          { name: 'Soldado', shortName: 'Sd', level: 0, emoji: '👮' },
        ],
      },
    },
  ],

  // ═══════════════════════════════════════
  // SEPARADORES VISUAIS (divisórias entre blocos de cargos)
  // ═══════════════════════════════════════
  separatorRoles: [
    { name: '───────── ⚙️ SISTEMA ─────────', block: 'shared', color: '#2b2d31' },
    { name: '───────── 🛡️ PMESP ─────────', block: 'pmesp', color: '#2b2d31' },
    { name: '──── ⚠️ ADVERTÊNCIAS PMESP ────', block: 'adv_pmesp', color: '#2b2d31' },
    { name: '───────── 🛡️ PCESP ─────────', block: 'pcesp', color: '#2b2d31' },
    { name: '──── ⚠️ ADVERTÊNCIAS PCESP ────', block: 'adv_pcesp', color: '#2b2d31' },
    { name: '───────── ⚡ BATALHÕES ─────────', block: 'tags', color: '#2b2d31' },
    { name: '──── 📚 CURSOS PMESP ────', block: 'courses_pmesp', color: '#2b2d31' },
    { name: '──── 📚 CURSOS PCESP ────', block: 'courses_pcesp', color: '#2b2d31' },
  ],

  // ═══════════════════════════════════════
  // CARGOS COMPARTILHADOS (globais do servidor)
  // ═══════════════════════════════════════
  sharedRoles: [
    { name: '🛠️ ┃ Setup Autorizado', color: '#e67e22', key: 'setup' },
    { name: '👤 ┃ Cidadão', color: '#7f8c8d', key: 'cidadao' },
  ],

  // ═══════════════════════════════════════
  // TEMPLATE DE CANAIS — TUDO UNIFICADO SSP
  // Todos os canais são compartilhados entre as corporações.
  // A distinção PMESP/PCESP acontece via cargos e select menus.
  // ═══════════════════════════════════════
  sharedChannelTemplate: {
    operacional: {
      category: '📄・OPERACIONAL SSP',
      categoryKey: null,
      channels: [
        { name: '📄・painel-ponto', key: 'pontoPanel' },
        { name: '📄・painel-ausencia', key: 'ausenciaPanel' },
        { name: '📄・painel-avaliacao', key: 'avaliacaoPanel' },
        { name: '📄・painel-academia', key: 'academiaPanel' },
        { name: '📄・avisos-academia', key: 'academiaAvisos' },
      ],
    },
    atendimento: {
      category: '📄・ATENDIMENTO SSP',
      categoryKey: 'ticketsCategory',
      channels: [
        { name: '📄・painel-tickets', key: 'ticketsPanel' },
        { name: '📄・painel-edital', key: 'editalPanel' },
        { name: '📄・avaliacao-pmesp', key: 'editalAvaliacaoPmesp' },
        { name: '📄・avaliacao-pcesp', key: 'editalAvaliacaoPcesp' },
        { name: '📄・resultados-pmesp', key: 'editalResultadosPmesp' },
        { name: '📄・resultados-pcesp', key: 'editalResultadosPcesp' },
      ],
    },
    corregedoria: {
      category: '📄・CORREGEDORIA SSP',
      categoryKey: 'corregedoriaCategory',
      channels: [
        { name: '📄・painel-advertencias', key: 'warningPanel' },
        { name: '📄・resultados-corregedoria', key: 'corregedoriaResults' },
      ],
    },
    logs: {
      category: '📄・LOGS SSP',
      categoryKey: null,
      channels: [
        { name: '📄・log-ponto', key: 'pontoLogs' },
        { name: '📄・log-copom', key: 'copomLogs' },
        { name: '📄・log-ausencias', key: 'ausenciaLogs' },
        { name: '📄・log-gerais', key: 'adminLogs' },
        { name: '📄・log-membros', key: 'memberLogs' },
        { name: '📄・log-avaliacoes', key: 'avaliacaoLogs' },
      ],
    },
    logsPmesp: {
      category: '📄・LOGS PMESP',
      categoryKey: null,
      channels: [
        { name: '📄・log-ponto-pmesp', key: 'pontoLogsPmesp' },
        { name: '📄・log-ausencia-pmesp', key: 'ausenciaLogsPmesp' },
      ],
    },
    logsPcesp: {
      category: '📄・LOGS PCESP',
      categoryKey: null,
      channels: [
        { name: '📄・log-ponto-pcesp', key: 'pontoLogsPcesp' },
        { name: '📄・log-ausencia-pcesp', key: 'ausenciaLogsPcesp' },
      ],
    },
  },

  // ═══════════════════════════════════════
  // LISTA DE SLUGS VÁLIDOS (para validação rápida)
  // ═══════════════════════════════════════
  get allSlugs() {
    return [
      ...this.corporations.map(c => c.slug),
      ...this.tags.map(t => t.slug),
    ];
  },

  /**
   * Retorna a hierarquia computada de uma tag (herda da corp-mãe + overrides).
   */
  getResolvedRanks(slug) {
    const corp = this.corporations.find(c => c.slug === slug);
    if (corp) return [...corp.ranks];

    const tag = this.tags.find(t => t.slug === slug);
    if (!tag) return [];

    const parent = this.corporations.find(c => c.slug === tag.inheritsFrom);
    if (!parent) return [];

    let ranks = parent.ranks.filter(r => !tag.rankOverrides.remove.includes(r.name));
    ranks = [...tag.rankOverrides.add, ...ranks];

    ranks.sort((a, b) => a.level - b.level);
    return ranks.map((r, i) => ({ ...r, level: i }));
  },

  /**
   * Retorna a corporação primária de um slug (resolve tags para corp-mãe).
   */
  getPrimaryCorporation(slug) {
    const corp = this.corporations.find(c => c.slug === slug);
    if (corp) return corp;

    const tag = this.tags.find(t => t.slug === slug);
    if (tag) return this.corporations.find(c => c.slug === tag.inheritsFrom);

    return null;
  },
};
