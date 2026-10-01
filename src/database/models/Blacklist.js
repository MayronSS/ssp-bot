const mongoose = require('mongoose');

const blacklistSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true,
    index: true,
  },
  passaporte: {
    type: String,
    required: true,
    index: true,
  },
  discordId: {
    type: String,
    default: '',
  },
  nomeRp: {
    type: String,
    required: true,
  },
  motivo: {
    type: String,
    required: true,
  },
  addedBy: {
    type: String,
    required: true,
  },
}, { timestamps: true });

// Garantir indexação
blacklistSchema.index({ guildId: 1, passaporte: 1 }, { unique: true });

module.exports = mongoose.models.Blacklist || mongoose.model('Blacklist', blacklistSchema);
