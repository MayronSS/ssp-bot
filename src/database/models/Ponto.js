const mongoose = require('mongoose');

const pontoSchema = new mongoose.Schema({
  corporationSlug: {
    type: String,
    default: 'pmesp',
    index: true,
  },
  battalionSlug: {
    type: String,
    default: null,
  },
  userId: {
    type: String,
    required: true,
    index: true,
  },
  username: {
    type: String,
    required: true,
  },
  entrada: {
    type: Date,
    required: true,
  },
  saida: {
    type: Date,
    default: null,
  },
  durationMs: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['aberto', 'fechado'],
    default: 'aberto',
    index: true,
  }
}, { timestamps: true });

// Otimizar buscas por usuário e status
pontoSchema.index({ corporationSlug: 1, userId: 1, status: 1 });

module.exports = mongoose.model('Ponto', pontoSchema);
