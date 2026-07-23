const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'stickerUpdate',

  async execute(oldSticker, newSticker) {
    await auditLogService.handleStickerUpdate(oldSticker, newSticker);
  },
};
