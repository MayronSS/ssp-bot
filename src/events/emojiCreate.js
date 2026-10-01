const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'emojiCreate',

  async execute(emoji) {
    await auditLogService.handleEmojiCreate(emoji);
  },
};
