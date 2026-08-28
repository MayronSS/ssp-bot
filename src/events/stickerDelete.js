const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'stickerDelete',

  async execute(sticker) {
    await auditLogService.handleStickerDelete(sticker);
  },
};
