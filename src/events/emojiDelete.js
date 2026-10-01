const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'emojiDelete',

  async execute(emoji) {
    await auditLogService.handleEmojiDelete(emoji);
  },
};
