const mongoose = require('mongoose');

const suggestionSchema = new mongoose.Schema({
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
  content: {
    type: String,
    required: true,
  },
  votesUp: {
    type: [String],
    default: [],
  },
  votesDown: {
    type: [String],
    default: [],
  },
}, { timestamps: true });

module.exports = mongoose.models.Suggestion || mongoose.model('Suggestion', suggestionSchema);
