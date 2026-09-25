const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'channelDelete',

  async execute(channel) {
    await auditLogService.handleChannelDelete(channel);
  },
};
