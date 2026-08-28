const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'channelCreate',

  async execute(channel) {
    await auditLogService.handleChannelCreate(channel);
  },
};
