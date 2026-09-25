const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const DEFAULT_EMOJIS = {
  clock: '🕙',
  trophy: '🏆',
  check: '✅',
  stop: '⏹️',
  refresh: '🔄',
  clipboard: '📋',
  user: '👮',
  calendar: '🗓️',
  idcard: '🪪',
  shield_pm: '🛡️',
  shield_pc: '🛡️',
  star_badge: '⭐',
  warning: '🔔',
  evaluation: '📋',
  graduation: '🎓',
};

const emojiCache = { ...DEFAULT_EMOJIS };
const rawEmojiCache = { ...DEFAULT_EMOJIS };

const EMOJI_FILES = {
  lspd_white_clock: {
    file: 'emoji_clock.png',
    key: 'clock',
    default: DEFAULT_EMOJIS.clock,
    forceRecreate: false,
  },
  lspd_white_trophy: {
    file: 'emoji_trophy.png',
    key: 'trophy',
    default: DEFAULT_EMOJIS.trophy,
    forceRecreate: false,
  },
  lspd_white_check: {
    file: 'emoji_check.png',
    key: 'check',
    default: DEFAULT_EMOJIS.check,
    forceRecreate: false,
  },
  lspd_white_stop: {
    file: 'emoji_stop.png',
    key: 'stop',
    default: DEFAULT_EMOJIS.stop,
    forceRecreate: false,
  },
  lspd_white_refresh: {
    file: 'emoji_refresh.png',
    key: 'refresh',
    default: DEFAULT_EMOJIS.refresh,
    forceRecreate: false,
  },
  lspd_white_clipboard: {
    file: 'emoji_clipboard.png',
    key: 'clipboard',
    default: DEFAULT_EMOJIS.clipboard,
    forceRecreate: false,
  },
  lspd_white_user: {
    file: 'emoji_user.png',
    key: 'user',
    default: DEFAULT_EMOJIS.user,
    forceRecreate: false,
  },
  lspd_white_calendar: {
    file: 'emoji_calendar.png',
    key: 'calendar',
    default: DEFAULT_EMOJIS.calendar,
    forceRecreate: false,
  },
  lspd_white_idcard: {
    file: 'emoji_idcard.png',
    key: 'idcard',
    default: DEFAULT_EMOJIS.idcard,
    forceRecreate: false,
  },
  lspd_white_shield_pm: {
    file: 'emoji_shield_pm.png',
    key: 'shield_pm',
    default: DEFAULT_EMOJIS.shield_pm,
    forceRecreate: false,
  },
  lspd_white_shield_pc: {
    file: 'emoji_shield_pc.png',
    key: 'shield_pc',
    default: DEFAULT_EMOJIS.shield_pc,
    forceRecreate: false,
  },
  lspd_white_star_badge: {
    file: 'emoji_star_badge.png',
    key: 'star_badge',
    default: DEFAULT_EMOJIS.star_badge,
    forceRecreate: false,
  },
  lspd_white_warning: {
    file: 'emoji_warning.png',
    key: 'warning',
    default: DEFAULT_EMOJIS.warning,
    forceRecreate: false,
  },
  lspd_white_evaluation: {
    file: 'emoji_evaluation.png',
    key: 'evaluation',
    default: DEFAULT_EMOJIS.evaluation,
    forceRecreate: false,
  },
  lspd_white_graduation: {
    file: 'emoji_graduation.png',
    key: 'graduation',
    default: DEFAULT_EMOJIS.graduation,
    forceRecreate: false,
  },
};

function applyEmojiToCache(key, fallback, emojiObj = null) {
  if (!emojiObj) {
    emojiCache[key] = fallback;
    rawEmojiCache[key] = fallback;
    return;
  }

  emojiCache[key] = `<:${emojiObj.name}:${emojiObj.id}>`;
  rawEmojiCache[key] = {
    id: emojiObj.id,
    name: emojiObj.name,
  };
}

async function init(guild) {
  const assetsDir = path.join(__dirname, '..', 'assets', 'images');

  logger.info('Carregando emojis customizados brancos da LSPD...');

  const existingEmojis = await guild.emojis.fetch().catch((err) => {
    logger.warn('Não foi possível buscar emojis da guilda. Usando fallbacks unicode. Detalhe: ' + err.message);
    return null;
  });

  for (const [name, config] of Object.entries(EMOJI_FILES)) {
    let emojiObj = null;

    if (existingEmojis) {
      emojiObj = existingEmojis.cache
        ? existingEmojis.cache.find((emoji) => emoji.name === name)
        : existingEmojis.find((emoji) => emoji.name === name);
    }

    // Se o emoji precisa ser recriado (ex: atualização de imagem)
    if (emojiObj && config.forceRecreate) {
      try {
        await guild.emojis.delete(emojiObj.id, 'Recriando emoji com imagem atualizada');
        logger.info(`Emoji :${name}: deletado para recriação.`);
        emojiObj = null;
      } catch (err) {
        logger.warn(`Erro ao deletar emoji :${name}: para recriação: ${err.message}`);
      }
    }

    if (!emojiObj && existingEmojis) {
      const filePath = path.join(assetsDir, config.file);

      if (!fs.existsSync(filePath)) {
        logger.warn(`Arquivo do emoji não encontrado em: ${filePath}`);
        applyEmojiToCache(config.key, config.default);
        continue;
      }

      try {
        emojiObj = await guild.emojis.create({
          attachment: filePath,
          name,
        });
        logger.success(`Emoji customizado criado: :${name}:`);
      } catch (err) {
        logger.warn(`Erro ao criar emoji :${name}:. Usando fallback unicode. Detalhe: ${err.message}`);
      }
    }

    applyEmojiToCache(config.key, config.default, emojiObj);
  }
}

function get(key) {
  return emojiCache[key] || DEFAULT_EMOJIS[key] || DEFAULT_EMOJIS.clock;
}

function getRaw(key) {
  return rawEmojiCache[key] || DEFAULT_EMOJIS[key] || DEFAULT_EMOJIS.clock;
}

function findCustomRankEmoji(guild, rank) {
  if (!guild || !rank) return null;
  const name = rank.name;
  const shortName = rank.shortName;
  
  const normalizedRankName = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  const normalizedShortName = shortName ? shortName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') : '';

  const cache = guild.emojis.cache;
  
  if (normalizedShortName) {
    const foundShort = cache.find(e => {
      const eNorm = e.name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
      return eNorm === normalizedShortName;
    });
    if (foundShort) return foundShort;
  }

  const foundFull = cache.find(e => {
    const eNorm = e.name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return eNorm === normalizedRankName;
  });
  if (foundFull) return foundFull;

  return null;
}

module.exports = {
  init,
  get,
  getRaw,
  findCustomRankEmoji,
};
