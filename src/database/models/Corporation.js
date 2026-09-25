const mongoose = require('mongoose');

const rankSubSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    shortName: { type: String, required: true },
    level: { type: Number, required: true },
    emoji: { type: String, default: '' },
    roleId: { type: String, default: null },
  },
  { _id: false }
);

const subdivisionSubSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true },
    name: { type: String, required: true },
    shortName: { type: String, required: true },
    color: { type: String, default: '' },
    emoji: { type: String, default: '' },
    roleId: { type: String, default: null },
  },
  { _id: false }
);

const exclusiveRankSubSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    roleName: { type: String, required: true },
    roleId: { type: String, default: null },
  },
  { _id: false }
);

const corporationSchema = new mongoose.Schema(
  {
    guildId: {
      type: String,
      required: true,
      index: true,
    },

    // Identidade
    slug: { type: String, required: true },
    name: { type: String, required: true },
    shortName: { type: String, required: true },
    color: { type: String, default: '#1B52F1' },
    emoji: { type: String, default: '🛡️' },

    // Tipo: 'primary' (PMESP, PCESP) ou 'tag' (FT, ROTA, BAEP, BPRV)
    type: {
      type: String,
      enum: ['primary', 'tag'],
      required: true,
    },

    // Para tags: slug da corporação-mãe
    inheritsFrom: { type: String, default: null },

    // IDs de cargos do Discord (preenchidos pelo /setup-patentes)
    roles: {
      geral: { type: String, default: null },
      comando: { type: String, default: null },
      staff: { type: String, default: null },
      administrativo: { type: String, default: null },
      ministrador: { type: String, default: null },
      cidadao: { type: String, default: null },
      recruta: { type: String, default: null },
      preAprovado: { type: String, default: null },
      advVerbal: { type: String, default: null },
      adv1: { type: String, default: null },
      adv2: { type: String, default: null },
      adv3: { type: String, default: null },
    },

    // Patentes com roleIds (preenchidos pelo /setup-patentes)
    ranks: {
      type: [rankSubSchema],
      default: [],
    },

    // Subdivisões/tags vinculadas (apenas para corporações primárias)
    subdivisions: {
      type: [subdivisionSubSchema],
      default: [],
    },

    // Patentes exclusivas de tags (ex: Estagiário Boina Cinza da ROTA)
    exclusiveRanks: {
      type: [exclusiveRankSubSchema],
      default: [],
    },

    // IDs de canais do Discord (preenchidos pelo /setup-canais)
    // Apenas corporações primárias têm canais; tags herdam da corp-mãe
    channels: {
      ticketsPanel: { type: String, default: null },
      ticketsCategory: { type: String, default: null },
      editalPanel: { type: String, default: null },
      editalAvaliacao: { type: String, default: null },
      editalResultados: { type: String, default: null },
      editalAvaliacaoPmesp: { type: String, default: null },
      editalAvaliacaoPcesp: { type: String, default: null },
      editalResultadosPmesp: { type: String, default: null },
      editalResultadosPcesp: { type: String, default: null },
      pontoPanel: { type: String, default: null },
      pontoLogs: { type: String, default: null },
      copomLogs: { type: String, default: null },
      adminLogs: { type: String, default: null },
      memberLogs: { type: String, default: null },
      corregedoriaCategory: { type: String, default: null },
      corregedoriaResults: { type: String, default: null },
      ausenciaPanel: { type: String, default: null },
      ausenciaLogs: { type: String, default: null },
      warningPanel: { type: String, default: null },
      avaliacaoPanel: { type: String, default: null },
      avaliacaoLogs: { type: String, default: null },
      academiaPanel: { type: String, default: null },
      academiaAvisos: { type: String, default: null },
      pontoLogsPmesp: { type: String, default: null },
      pontoLogsPcesp: { type: String, default: null },
      ausenciaLogsPmesp: { type: String, default: null },
      ausenciaLogsPcesp: { type: String, default: null },
      memberLogsEntrada: { type: String, default: null },
      memberLogsSaida: { type: String, default: null },
      exoneracoes: { type: String, default: null },
      transferencias: { type: String, default: null },
      solicitacoesInternas: { type: String, default: null },
      blacklist: { type: String, default: null },
      sugestoes: { type: String, default: null },
      hierarchy: { type: String, default: null },
    },

    // Módulos habilitados
    modules: {
      tickets: { type: Boolean, default: true },
      ponto: { type: Boolean, default: true },
      edital: { type: Boolean, default: true },
      ausencia: { type: Boolean, default: true },
      warning: { type: Boolean, default: true },
      avaliacao: { type: Boolean, default: true },
    },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Índice único: uma corporação por guild+slug
corporationSchema.index({ guildId: 1, slug: 1 }, { unique: true });

module.exports =
  mongoose.models.Corporation ||
  mongoose.model('Corporation', corporationSchema);
