const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'stickerCreate',

  async execute(sticker) {
    await auditLogService.handleStickerCreate(sticker);
  },
};
