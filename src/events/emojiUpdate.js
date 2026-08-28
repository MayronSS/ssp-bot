const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'emojiUpdate',

  async execute(oldEmoji, newEmoji) {
    await auditLogService.handleEmojiUpdate(oldEmoji, newEmoji);
  },
};
