const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'channelUpdate',

  async execute(oldChannel, newChannel) {
    await auditLogService.handleChannelUpdate(oldChannel, newChannel);
  },
};
