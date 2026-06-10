const auditLogService = require('../services/auditLogService');

module.exports = {
  name: 'voiceStateUpdate',

  async execute(oldState, newState) {
    await auditLogService.handleVoiceStateUpdate(oldState, newState);
  },
};
