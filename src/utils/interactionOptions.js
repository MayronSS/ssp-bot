const { MessageFlags } = require('discord.js');

const EPHEMERAL_REPLY = Object.freeze({
  flags: MessageFlags.Ephemeral,
});

function normalizeFlags(flags) {
  if (!flags) return 0;
  if (typeof flags === 'number') return flags;
  if (typeof flags === 'bigint') return Number(flags);
  if (typeof flags === 'string') return Number(flags);
  if (typeof flags.bitfield === 'number') return flags.bitfield;

  if (typeof flags.valueOf === 'function') {
    const value = flags.valueOf();
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
  }

  return 0;
}

function withEphemeral(options = {}) {
  return {
    ...options,
    flags: normalizeFlags(options.flags) | MessageFlags.Ephemeral,
  };
}

module.exports = {
  EPHEMERAL_REPLY,
  withEphemeral,
};
