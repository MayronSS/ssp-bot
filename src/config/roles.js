const env = require('./env');

module.exports = {
  command: env.ROLE_COMMAND,
  setup: env.ROLE_SETUP,
  ticketStaff: env.ROLE_TICKET_STAFF,
  policial: env.ROLE_POLICIAL,
  recruta: env.ROLE_RECRUTA,
};
