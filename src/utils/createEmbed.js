const { EmbedBuilder } = require('discord.js');
const embedsConfig = require('../config/embeds');

/**
 * Helper para obter cores oficiais da LSPD
 */
const getLspdColor = (type) => {
  const colors = embedsConfig.design.colors;
  switch (type) {
    case 'success':
      return colors.success || '#00E676';
    case 'danger':
    case 'error':
      return colors.danger || '#D50000';
    case 'warning':
      return colors.warning || '#FFAB00';
    case 'dark':
    case 'neutral':
      return colors.dark || '#111625';
    case 'primary':
    default:
      return colors.primary || '#1B52F1';
  }
};

/**
 * Cria um embed padronizado com a identidade visual premium da LSPD.
 * 
 * @param {Object} options
 * @param {string} [options.title] - Título do embed
 * @param {string} [options.description] - Descrição do embed
 * @param {string} [options.colorType] - Tipo de cor ('primary', 'success', 'danger', 'warning', 'dark')
 * @param {string} [options.color] - Cor hex sobressalente
 * @param {Array}  [options.fields] - Array de { name, value, inline }
 * @param {Object} [options.footer] - Objeto { text, iconURL } ou string
 * @param {string} [options.thumbnail] - URL ou anexo da thumbnail
 * @param {string} [options.image] - URL ou anexo da imagem principal
 * @param {boolean} [options.timestamp=true] - Se deve incluir timestamp
 * @param {Object} [options.author] - Objeto { name, iconURL }
 * @param {boolean} [options.useDefaultAuthor=true] - Se deve colocar cabeçalho LSPD se autor for nulo
 * @param {boolean} [options.useDefaultFooter=true] - Se deve colocar rodapé padrão LSPD se footer for nulo
 * @returns {EmbedBuilder}
 */
function createBaseEmbed({
  title,
  description,
  colorType = 'primary',
  color,
  fields,
  footer,
  thumbnail,
  image,
  timestamp = true,
  author,
  useDefaultAuthor = true,
  useDefaultFooter = true,
} = {}) {
  const embed = new EmbedBuilder()
    .setColor(color || getLspdColor(colorType));

  // Título
  if (title) embed.setTitle(title);

  // Descrição
  if (description) embed.setDescription(description);

  // Configuração do Author
  if (author) {
    embed.setAuthor({
      name: author.name,
      iconURL: author.iconURL || embedsConfig.design.logo
    });
  } else if (useDefaultAuthor) {
    embed.setAuthor({
      name: 'SECRETARIA DE SEGURANÇA PÚBLICA',
      iconURL: embedsConfig.design.logo
    });
  }

  // Configuração do Footer
  if (footer) {
    if (typeof footer === 'string') {
      embed.setFooter({ text: footer, iconURL: embedsConfig.design.logo });
    } else {
      embed.setFooter({
        text: footer.text,
        iconURL: footer.iconURL || embedsConfig.design.logo
      });
    }
  } else if (useDefaultFooter) {
    embed.setFooter({
      text: 'SSP Central System • Protegendo e Servindo',
      iconURL: embedsConfig.design.logo
    });
  }

  // Thumbnail e Imagem
  if (thumbnail) {
    embed.setThumbnail(thumbnail);
  } else if (thumbnail === undefined) {
    const logoUrl = embedsConfig.design.logo;
    if (logoUrl) {
      embed.setThumbnail(logoUrl);
    }
  }
  if (image) {
    embed.setImage(image);
  }

  // Timestamp
  if (timestamp) {
    embed.setTimestamp();
  }

  // Campos
  if (fields && fields.length > 0) {
    embed.addFields(fields);
  }

  return embed;
}

/**
 * Cria um embed de sucesso.
 */
function createSuccessEmbed(title, description, fields = []) {
  return createBaseEmbed({
    title: `✅ ${title}`,
    description,
    colorType: 'success',
    fields,
  });
}

/**
 * Cria um embed de erro.
 */
function createErrorEmbed(title, description, fields = []) {
  return createBaseEmbed({
    title: `❌ ${title}`,
    description,
    colorType: 'danger',
    fields,
  });
}

/**
 * Cria um embed de aviso.
 */
function createWarningEmbed(title, description, fields = []) {
  return createBaseEmbed({
    title: `⚠️ ${title}`,
    description,
    colorType: 'warning',
    fields,
  });
}

/**
 * Cria um embed de log administrativo.
 */
function createLogEmbed({ title, description, fields = [], colorType = 'neutral' }) {
  return createBaseEmbed({
    author: {
      name: 'SSP AUDIT SYSTEM • SYSTEM LOG',
      iconURL: embedsConfig.design.logo
    },
    title,
    description,
    colorType,
    fields,
    footer: 'Registro de Auditoria Digital SSP'
  });
}

module.exports = {
  createBaseEmbed,
  createSuccessEmbed,
  createErrorEmbed,
  createWarningEmbed,
  createLogEmbed,
  getLspdColor
};
