const mongoose = require('mongoose');

const internalRequestSchema = new mongoose.Schema({
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
  batalhao: {
    type: String,
    required: true,
  },
  assunto: {
    type: String,
    required: true,
  },
  descricao: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
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

module.exports = mongoose.models.InternalRequest || mongoose.model('InternalRequest', internalRequestSchema);
