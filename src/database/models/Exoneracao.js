const mongoose = require('mongoose');

const exoneracaoSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true,
  },
  messageId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  userId: {
    type: String,
    required: true,
  },
  citizenId: {
    type: String,
    required: true,
  },
  motivo: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'approved',
    index: true,
  },
  resolvedBy: {
    type: String,
    default: null,
  },
  resolvedAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.models.Exoneracao || mongoose.model('Exoneracao', exoneracaoSchema);
