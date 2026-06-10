const env = require('../config/env');
const logger = require('../utils/logger');
const configService = require('./configService');
const { canManageTickets } = require('./permissionService');
const ticketsService = require('../modules/tickets/tickets.service');
const componentFactory = require('../utils/componentFactory');

const DEFAULT_TICKET_STAFF_ROLE_ID = '1507374673611063377';
const GEMINI_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_DISCORD_MESSAGE_LENGTH = 1900;
const REQUEST_TIMEOUT_MS = 25000;
const MAX_REPORT_ATTACHMENT_ITEMS = 8;
const MISSING_COMPLAINANT_NAME = 'identificacao do denunciante (nome ou anonimo)';
const MISSING_OFFICER_ID = 'badge, nome e sobrenome do oficial envolvido';
const MISSING_TIME = 'horário aproximado';
const MISSING_EVIDENCE = 'prova/anexo, se tiver';
const MISSING_EVIDENCE_FILE = 'arquivo ou link da prova mencionada';

const activeRequests = new Set();
const lastAutoReplyAt = new Map();
const lastFailureNoticeAt = new Map();
const sentCompletionReports = new Set();
const triageSessions = new Map();
const EVIDENCE_WORD_PATTERNS = [
  /\bimagem\b/i,
  /\bprint\b/i,
  /\bfoto\b/i,
  /\bvideo\b/i,
  /\bprova\b/i,
  /\banexo\b/i,
];
const COMPLAINT_WORD_PATTERNS = [
  /\bdenunci/i,
  /\brdm\b/i,
  /\bvdm\b/i,
  /\babuso\b/i,
  /\boficial\b/i,
  /\bpolicial\b/i,
];
const WORD_WITH_LETTERS_PATTERN = /[a-zA-ZÀ-ÿ]{2,}/g;
const UNKNOWN_ANSWER_PATTERNS = [
  /\bnao\s+(tenho|sei|lembro|possuo)\b/i,
  /\bn[aã]o\s+(tenho|sei|lembro|possuo)\b/i,
  /\bsem\s+(nome|id|identificacao|identifica[cç][aã]o)\b/i,
  /\bdesconhecido\b/i,
  /\bnao\s+informado\b/i,
  /\bn[aã]o\s+informado\b/i,
];

const ANONYMOUS_ANSWER_PATTERNS = [
  /\banonim[oa]\b/i,
  /\bprefiro\s+nao\s+(me\s+)?identificar\b/i,
  /\bsem\s+identificacao\b/i,
];
const NARRATIVE_WORD_PATTERNS = [
  /\b(eu|ele|ela|me|fui|foi|estava|aconteceu|ocorreu|porque|quando|onde|local|rua|motivo)\b/i,
  /\b(matou|atirou|bateu|prendeu|algemou|abordou|revistou|xingou|ameacou|perseguiu|multou|mandou|fez)\b/i,
  /\b(tiro|arma|viatura|prisao|abordagem|corrupcao|ilegal|sem\s+motivo)\b/i,
];

function isEnabled() {
  if (env.TICKET_AI_ENABLED === 'false') return false;
  return Boolean(env.GEMINI_API_KEY);
}

function getModel() {
  return env.GEMINI_MODEL || 'gemini-3.5-flash';
}

function getFallbackModels() {
  return [...new Set([
    getModel(),
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
  ].filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldTryNextModel(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('high demand') ||
    message.includes('overloaded') ||
    message.includes('rate limit') ||
    message.includes('quota') ||
    message.includes('not found') ||
    message.includes('not supported') ||
    message.includes('not available') ||
    message.includes('404') ||
    message.includes('429') ||
    message.includes('503')
  );
}

function getMaxHistory() {
  const value = Number(env.TICKET_AI_MAX_HISTORY || 12);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 25) : 12;
}

function getCooldownMs() {
  const value = Number(env.TICKET_AI_COOLDOWN_MS || 5000);
  return Number.isFinite(value) && value >= 0 ? value : 5000;
}

function isCompletionReportEnabled() {
  return env.TICKET_AI_REPORT_ENABLED !== 'false';
}

function truncate(text, max = 1200) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 15)}... [cortado]`;
}

function sanitizeDiscordText(text) {
  return truncate(String(text || '')
    .replace(/<@!?(\d+)>/g, '@usuário')
    .replace(/<@&(\d+)>/g, '@cargo')
    .replace(/<#(\d+)>/g, '#canal')
    .replace(/`/g, "'"), 1600);
}

function formatAttachments(message) {
  if (!message.attachments?.size) return '';

  const items = message.attachments
    .map((attachment) => attachment.name || attachment.url || attachment.id)
    .slice(0, 4);

  return items.length ? ` [anexos: ${items.join(', ')}]` : '';
}

function getMessageText(message) {
  const content = sanitizeDiscordText(message.content);
  const attachments = formatAttachments(message);
  return content || attachments ? `${content}${attachments}`.trim() : '[mensagem sem texto]';
}

function cleanUrl(url) {
  return String(url || '').replace(/[)>.,\]]+$/g, '');
}

function extractUrls(text) {
  return (String(text || '').match(/https?:\/\/\S+/gi) || []).map(cleanUrl);
}

function isImageReference(value) {
  return /\.(png|jpe?g|gif|webp|bmp|tiff?)(\?|#|$)/i.test(String(value || ''));
}

function isVideoReference(value) {
  return /\.(mp4|mov|webm|mkv|avi|m4v)(\?|#|$)/i.test(String(value || ''));
}

function getEvidenceTypeFromAttachment(attachment) {
  const contentType = String(attachment.contentType || '').toLowerCase();
  const reference = `${attachment.name || ''} ${attachment.url || ''}`;

  if (contentType.startsWith('image/') || isImageReference(reference)) return 'imagem';
  if (contentType.startsWith('video/') || isVideoReference(reference)) return 'video';
  return 'anexo';
}

function getEvidenceTypeFromUrl(url) {
  if (isImageReference(url)) return 'imagem';
  if (isVideoReference(url)) return 'video';
  if (/(youtube\.com|youtu\.be|streamable\.com|medal\.tv|twitch\.tv|clips\.twitch\.tv)/i.test(url)) return 'video';
  if (/(imgur\.com|gyazo\.com|prnt\.sc)/i.test(url)) return 'imagem';
  return 'link';
}

function messageHasEvidenceLink(message) {
  const mentionsEvidence = textIncludesAny(String(message.content || ''), EVIDENCE_WORD_PATTERNS);
  return extractUrls(message.content).some((url) => {
    const type = getEvidenceTypeFromUrl(url);
    return type === 'imagem' || type === 'video' || mentionsEvidence;
  });
}

function normalizeForDetection(text) {
  return String(text || '')
    .replace(/\[anexos:[^\]]+\]/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLoose(text) {
  return normalizeForDetection(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeDepartmentLabel(name) {
  return String(name || 'Suporte Geral')
    .replace(/\bDenúncia Anónima\b/g, 'Denúncia Anônima')
    .replace(/\bAtualização de Registo\b/g, 'Atualização de Registro');
}

function isTicketAiAllowed(ticket) {
  const reason = normalizeLoose(ticket?.reason || '');
  const compact = reason.replace(/[^a-z0-9]/g, '');
  return (
    reason.includes('denuncia') ||
    compact.includes('denuncia') ||
    compact.includes('denancia') ||
    reason.includes('corregedoria') ||
    compact.includes('corregedoria') ||
    reason.includes('assuntos internos') ||
    compact.includes('assuntosinternos')
  );
}

function isUnknownAnswer(text) {
  const normalized = normalizeLoose(text);
  return UNKNOWN_ANSWER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isAnonymousAnswer(text) {
  const normalized = normalizeLoose(text);
  return ANONYMOUS_ANSWER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasAtLeastTwoWords(text) {
  return (normalizeForDetection(text).match(WORD_WITH_LETTERS_PATTERN) || []).length >= 2;
}

function isTimeOnlyText(text) {
  return textIncludesAny(text, [/\b\d{1,2}:\d{2}\b/i, /\b\d{1,2}\s*(h|horas?|hrs?)\b/i, /\bhoje\b/i, /\bagora\b/i, /\bontem\b/i]);
}

function extractTimeFromText(text) {
  const normalized = normalizeForDetection(text);
  const match = normalized.match(/\b\d{1,2}:\d{2}\b/i)
    || normalized.match(/\b\d{1,2}\s*(?:h|horas?|hrs?)\b/i)
    || normalized.match(/\b(?:hoje|agora|ontem)\b/i);

  return match ? cleanReportValue(match[0], 80) : null;
}

function isLikelyNameText(text, { allowDigits = false } = {}) {
  const normalized = normalizeForDetection(text);
  const loose = normalizeLoose(normalized);
  if (!normalized || normalized.length > 100) return false;
  if (isUnknownAnswer(normalized)) return false;
  if (!allowDigits && /\d/.test(normalized)) return false;
  if (textIncludesAny(loose, COMPLAINT_WORD_PATTERNS)) return false;
  if (textIncludesAny(loose, EVIDENCE_WORD_PATTERNS)) return false;
  if (textIncludesAny(loose, NARRATIVE_WORD_PATTERNS)) return false;
  if (isTimeOnlyText(loose)) return false;

  return hasAtLeastTwoWords(normalized);
}

function extractPlainNameFromText(text) {
  const normalized = normalizeForDetection(text);
  if (isAnonymousAnswer(normalized)) return 'Anonimo';
  const explicit = normalized.match(/\b(?:meu\s+nome\s+(?:e|eh|é)|sou|nome)\s*:?\s*([a-zA-ZÀ-ÿ]{2,}(?:\s+[a-zA-ZÀ-ÿ]{2,}){1,4})/i);
  if (explicit) return cleanReportValue(explicit[1]);

  const beforeComplaint = normalized.match(/^([a-zA-ZÀ-ÿ]{2,}(?:\s+[a-zA-ZÀ-ÿ]{2,}){1,4})\s*,\s*(?:denunci|denunciar|denuncia)/i);
  if (beforeComplaint) return cleanReportValue(beforeComplaint[1]);

  return isLikelyNameText(normalized) ? cleanReportValue(normalized) : null;
}

function extractOfficerFromText(text) {
  const normalized = normalizeForDetection(text);
  const patterns = [
    /\b(?:oficial|policial|agente)\s+(?!denunciado\b|envolvido\b|me\b|que\b|um\b|uma\b|o\b|a\b|matou\b|atirou\b|prendeu\b|abordou\b)([a-zA-ZÀ-ÿ0-9]{2,}(?:\s+[a-zA-ZÀ-ÿ0-9]{2,}){0,4})/i,
    /^([a-zA-ZÀ-ÿ]{2,}(?:\s+[a-zA-ZÀ-ÿ]{2,}){0,4}\s+\d{1,8})\b/i,
    /\bdenunci(?:ar|a)?\s+(?!um\b|uma\b|o\b|a\b|oficial\b|policial\b)([a-zA-ZÀ-ÿ]{2,}(?:\s+[a-zA-ZÀ-ÿ]{2,}){1,4})/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return cleanReportValue(match[1]);
  }

  return null;
}

function hasMessageEvidence(message) {
  return Boolean(message.attachments?.size) || messageHasEvidenceLink(message);
}

function hasComplainantName(userMessages) {
  return userMessages.some((item) => {
    const text = normalizeForDetection(item.text);
    if (!text || text.length > 120) return false;
    if (isAnonymousAnswer(text)) return true;

    return (
      /\b(meu\s+nome\s+(e|eh|é)|sou|nome)\s*:?\s*[a-zA-ZÀ-ÿ]{2,}\s+[a-zA-ZÀ-ÿ]{2,}/i.test(text) ||
      /^[a-zA-ZÀ-ÿ]{2,}(?:\s+[a-zA-ZÀ-ÿ]{2,}){1,4}\s*,\s*(denunci|denunciar|denuncia)/i.test(text) ||
      isLikelyNameText(text)
    );
  });
}

function hasOfficerIdentification(userMessages) {
  const explicitOfficer = userMessages.some((item) => {
    const text = normalizeForDetection(item.text);
    if (!text) return false;

    return (
      /\b(oficial|policial|agente)\s+(?!denunciado\b|envolvido\b|me\b|que\b|um\b|uma\b|o\b|a\b|matou\b|atirou\b|prendeu\b|abordou\b)[a-zA-ZÀ-ÿ0-9]{2,}(?:\s+[a-zA-ZÀ-ÿ0-9]{2,})?/i.test(text) ||
      /^[a-zA-ZÀ-ÿ]{2,}(?:\s+[a-zA-ZÀ-ÿ]{2,}){0,4}\s+\d{1,8}\b/i.test(text) ||
      /\bdenunci(?:ar|a)?\s+(?!um\b|uma\b|o\b|a\b|oficial\b|policial\b)[a-zA-ZÀ-ÿ]{2,}\s+[a-zA-ZÀ-ÿ]{2,}/i.test(text)
    );
  });

  if (explicitOfficer) return true;

  const complainantIndex = userMessages.findIndex((item) => hasComplainantName([item]));
  if (complainantIndex < 0) return false;

  return userMessages
    .slice(complainantIndex + 1)
    .some((item) => isLikelyNameText(item.text, { allowDigits: true }));
}

function hasOfficerUnknownAnswer(userMessages) {
  const complainantIndex = userMessages.findIndex((item) => hasComplainantName([item]));
  if (complainantIndex < 0) return false;

  for (const item of userMessages.slice(complainantIndex + 1)) {
    const text = item.text;
    if (textIncludesAny(text, EVIDENCE_WORD_PATTERNS) || isTimeOnlyText(text)) return false;
    if (isUnknownAnswer(text)) return true;
    if (isLikelyNameText(text, { allowDigits: true })) return false;
  }

  return false;
}

async function getStaffRoleId(guild) {
  const configuredRole = await configService.getRole(guild.id, 'ticketStaff').catch(() => null);
  return configuredRole || env.ROLE_TICKET_STAFF || DEFAULT_TICKET_STAFF_ROLE_ID;
}

async function getActorInfo(message, ticket) {
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  const staffRoleId = await getStaffRoleId(message.guild);
  const hasResponsibleRole = Boolean(staffRoleId && member?.roles?.cache?.has(staffRoleId));
  const isClaimedResponsible = Boolean(ticket?.claimedBy && ticket.claimedBy === message.author.id);
  const canManage = member ? await canManageTickets(member).catch(() => false) : false;
  const isTicketOwner = ticket?.userId === message.author.id;
  const isResponsible = !isTicketOwner && (hasResponsibleRole || isClaimedResponsible || canManage);

  return {
    member,
    staffRoleId,
    isResponsible,
    isTicketOwner,
    type: isResponsible ? 'responsavel' : isTicketOwner ? 'usuario' : 'participante',
    displayName: member?.displayName || message.author.username,
  };
}

function isAiTriggered(message) {
  const content = message.content.trim();
  const botId = message.client.user?.id;
  return (
    (botId && message.mentions?.users?.has(botId)) ||
    /^!ia\b/i.test(content) ||
    /^ia\s*:/i.test(content) ||
    /^ia\s+/i.test(content)
  );
}

function stripAiTrigger(message) {
  const botId = message.client.user?.id;
  return message.content
    .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
    .replace(/^!ia\b/i, '')
    .replace(/^ia\s*:/i, '')
    .replace(/^ia\s+/i, '')
    .trim();
}

function canAutoReply(channelId) {
  const cooldownMs = getCooldownMs();
  const last = lastAutoReplyAt.get(channelId) || 0;
  if (Date.now() - last < cooldownMs) return false;

  lastAutoReplyAt.set(channelId, Date.now());
  return true;
}

function buildInstructions() {
  return [
    'Você é a assistente virtual da SSP dentro de tickets do Discord.',
    'Responda sempre em português do Brasil, com tom profissional, objetivo e acolhedor.',
    'Você não é um oficial humano. Identifique-se como assistente virtual quando isso ajudar.',
    'Sua funcao principal e fazer triagem curta: registrar somente identificacao do denunciante (nome ou anonimo), oficial denunciado, horario aproximado e prova.',
    'Leia o histórico antes de responder. Nunca peça novamente um dado que já aparece em "Dados já coletados".',
    'Se todos os dados essenciais estiverem coletados, não faça novas perguntas. Confirme o recebimento e diga que um responsável humano dará continuidade.',
    'Quando falar com o usuário/cidadão, faça no máximo 1 pergunta objetiva por resposta.',
    'Nunca peça contexto, motivo detalhado, local, nome de usuário no jogo, ID do cidadão ou dados extras na triagem do cidadão.',
    'Quando falar com responsável/staff, aja como apoio interno: resuma, sugira resposta ou próximo passo. Não dê ordens.',
    'Não prometa punições, aprovações, reembolsos ou resultados oficiais.',
    'Não solicite senhas, tokens, dados bancários ou informações pessoais sensíveis.',
    'Se houver risco, ameaça, denúncia grave, corregedoria ou prova sensível, oriente a aguardar um responsável humano.',
    'Não diga que recebeu imagem/vídeo se o histórico não mostrar "[anexos: ...]". Se o usuário apenas escrever "imagem", peça para anexar o arquivo.',
    'Para denuncia contra oficial, os dados essenciais sao somente: identificacao do denunciante (nome ou anonimo), badge com nome e sobrenome do oficial denunciado, horario aproximado e prova/anexo.',
    'Não mencione usuários/cargos usando ping real. Use texto simples quando precisar se referir a alguém.',
  ].join('\n');
}

function roleLabel(actorType) {
  if (actorType === 'responsavel') return 'RESPONSÁVEL/STAFF';
  if (actorType === 'usuario') return 'USUÁRIO DONO DO TICKET';
  return 'PARTICIPANTE DO TICKET';
}

function userMessagesFromHistory(history, ticket, clientUserId) {
  return history
    .filter((message) => !message.system && message.author.id === ticket.userId && message.author.id !== clientUserId)
    .map((message) => ({
      text: getMessageText(message),
      hasAttachment: Boolean(message.attachments?.size),
      hasEvidenceLink: messageHasEvidenceLink(message),
    }));
}

function textIncludesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function buildTriageState(history, ticket, channel) {
  const userMessages = userMessagesFromHistory(history, ticket, channel.client.user.id);
  const allText = userMessages.map((item) => item.text).join('\n').toLowerCase();
  const hasAttachment = userMessages.some((item) => item.hasAttachment || item.text.includes('[anexos:'));
  const hasEvidenceLink = userMessages.some((item) => item.hasEvidenceLink);
  const mentionedEvidenceText = textIncludesAny(allText, EVIDENCE_WORD_PATTERNS);
  const evidenceExplicitlyAbsent = textIncludesAny(allText, [
    /\bsem\s+(imagens?|prints?|fotos?|videos?|provas?|anexos?)/i,
    /\b(n[a\u00e3]o|nao)\s+(tenho|possuo)\s+(imagens?|prints?|fotos?|videos?|provas?|anexos?)/i,
  ]);
  const hasEvidence = hasAttachment || hasEvidenceLink;
  const hasTime = textIncludesAny(allText, [/\b\d{1,2}:\d{2}\b/i, /\b\d{1,2}\s*(h|horas?|hrs?)\b/i, /\bhoje\b/i, /\bagora\b/i, /\bontem\b/i]);

  const state = {
    issueType: textIncludesAny(allText, [/denunci/i, /oficial/i, /matou/i, /abuso/i])
      ? 'denúncia contra oficial'
      : 'atendimento geral',
    complainantName: hasComplainantName(userMessages),
    officer: hasOfficerIdentification(userMessages),
    officerUnknown: hasOfficerUnknownAnswer(userMessages),
    time: hasTime,
    evidence: hasEvidence,
    evidenceExplicitlyAbsent,
    mentionedEvidenceText,
  };

  const collected = [
    state.issueType ? `Tipo: ${state.issueType}` : null,
    state.complainantName ? 'Identificacao do denunciante: informada' : null,
    state.officer ? 'Oficial envolvido: informado' : state.officerUnknown ? 'Oficial envolvido: usuário informou que não sabe' : null,
    state.time ? 'Horário aproximado: informado' : null,
    state.evidence ? 'Prova/anexo: arquivo ou link anexado' : state.evidenceExplicitlyAbsent ? 'Prova/anexo: usuário informou que não possui' : state.mentionedEvidenceText ? 'Prova/anexo: usuário mencionou, mas nenhum arquivo/link aparece no histórico' : null,
  ].filter(Boolean);

  const missing = [];
  if (!state.complainantName) missing.push(MISSING_COMPLAINANT_NAME);
  if (!state.officer && !state.officerUnknown) missing.push(MISSING_OFFICER_ID);
  if (!state.time) missing.push(MISSING_TIME);
  if (!state.evidence && !state.evidenceExplicitlyAbsent && !state.mentionedEvidenceText) missing.push(MISSING_EVIDENCE);
  if (state.mentionedEvidenceText && !state.evidence && !state.evidenceExplicitlyAbsent) missing.push(MISSING_EVIDENCE_FILE);

  return {
    collected,
    missing,
    complete: state.complainantName && (state.officer || state.officerUnknown) && state.time && (state.evidence || state.evidenceExplicitlyAbsent),
  };
}

function createTriageSession(ticket, channelId) {
  return {
    channelId,
    ticketId: String(ticket?._id || ticket?.channelId || channelId),
    userId: ticket?.userId,
    username: ticket?.username,
    complainantName: null,
    officerLabel: null,
    officerUnknown: false,
    timeLabel: null,
    evidenceStatus: null,
    evidenceMentionedWithoutFile: false,
    narrativeMessages: [],
    updatedAt: Date.now(),
  };
}

function getTriageSession(channelId, ticket) {
  const existing = triageSessions.get(channelId);
  const ticketId = String(ticket?._id || ticket?.channelId || channelId);

  if (existing && existing.ticketId === ticketId) return existing;

  const session = createTriageSession(ticket, channelId);
  triageSessions.set(channelId, session);
  return session;
}

function getStateMissing(session) {
  const missing = [];

  if (!session.complainantName) missing.push(MISSING_COMPLAINANT_NAME);
  if (!session.officerLabel && !session.officerUnknown) missing.push(MISSING_OFFICER_ID);
  if (!session.timeLabel) missing.push(MISSING_TIME);
  if (!session.evidenceStatus) {
    missing.push(session.evidenceMentionedWithoutFile
      ? MISSING_EVIDENCE_FILE
      : MISSING_EVIDENCE);
  }

  return missing;
}

function buildTriageSnapshotFromSession(session) {
  const collected = [
    'Tipo: denúncia contra oficial',
    session.complainantName ? 'Identificacao do denunciante: informada' : null,
    session.officerLabel ? 'Oficial envolvido: informado' : session.officerUnknown ? 'Oficial envolvido: usuário informou que não sabe' : null,
    session.timeLabel ? 'Horário aproximado: informado' : null,
    session.evidenceStatus === 'provided'
      ? 'Prova/anexo: arquivo ou link anexado'
      : session.evidenceStatus === 'absent'
        ? 'Prova/anexo: usuário informou que não possui'
        : session.evidenceMentionedWithoutFile
          ? 'Prova/anexo: usuário mencionou, mas nenhum arquivo/link aparece no histórico'
          : null,
  ].filter(Boolean);

  const missing = getStateMissing(session);

  return {
    collected,
    missing,
    complete: !missing.length,
  };
}

function shouldRecordNarrative(text) {
  const normalized = normalizeForDetection(text);
  if (!normalized || normalized.length < 6) return false;
  if (isUnknownAnswer(normalized)) return false;
  if (isLikelyNameText(normalized, { allowDigits: true })) return false;
  if (isTimeOnlyText(normalized) && normalized.length <= 30) return false;
  if (textIncludesAny(normalized, EVIDENCE_WORD_PATTERNS) && normalized.length <= 40) return false;
  return true;
}

function rememberNarrative(session, text) {
  if (!shouldRecordNarrative(text)) return;

  const clean = cleanReportValue(text, 280);
  if (!session.narrativeMessages.includes(clean)) {
    session.narrativeMessages.push(clean);
  }

  if (session.narrativeMessages.length > 6) {
    session.narrativeMessages.shift();
  }
}

function updateTriageSessionWithMessage(session, message) {
  if (!message || message.system || message.author?.id !== session.userId) return;

  const text = getMessageText(message);
  const cleanText = normalizeForDetection(text);
  const firstMissing = getStateMissing(session)[0];
  const hasEvidence = hasMessageEvidence(message);
  const mentionedEvidence = textIncludesAny(cleanText, EVIDENCE_WORD_PATTERNS);
  const timeLabel = extractTimeFromText(cleanText);

  if (!session.complainantName) {
    const name = isAnonymousAnswer(cleanText) ? 'Anonimo' : extractPlainNameFromText(cleanText);
    if (name) session.complainantName = name;
  }

  if (!session.officerLabel && !session.officerUnknown) {
    if (firstMissing === MISSING_OFFICER_ID && isUnknownAnswer(cleanText)) {
      session.officerUnknown = true;
    } else {
      const explicitOfficer = extractOfficerFromText(cleanText);
      if (explicitOfficer) {
        session.officerLabel = explicitOfficer;
      } else if (firstMissing === MISSING_OFFICER_ID && isLikelyNameText(cleanText, { allowDigits: true })) {
        session.officerLabel = cleanReportValue(cleanText, 120);
      }
    }
  }

  if (!session.timeLabel && timeLabel) {
    session.timeLabel = timeLabel;
  }

  if (hasEvidence) {
    session.evidenceStatus = 'provided';
    session.evidenceMentionedWithoutFile = false;
  } else if (firstMissing === MISSING_EVIDENCE || firstMissing === MISSING_EVIDENCE_FILE) {
    if (isUnknownAnswer(cleanText)) {
      session.evidenceStatus = 'absent';
      session.evidenceMentionedWithoutFile = false;
    } else if (mentionedEvidence) {
      session.evidenceMentionedWithoutFile = true;
    }
  } else if (/\bsem\s+(imagens?|prints?|fotos?|videos?|provas?|anexos?)/i.test(cleanText)) {
    session.evidenceStatus = 'absent';
    session.evidenceMentionedWithoutFile = false;
  }

  rememberNarrative(session, cleanText);
  session.updatedAt = Date.now();
}

function rebuildTriageSessionFromHistory(channelId, ticket, history) {
  const session = createTriageSession(ticket, channelId);

  for (const message of history) {
    updateTriageSessionWithMessage(session, message);
  }

  const existing = triageSessions.get(channelId);
  if (existing && existing.ticketId === session.ticketId) {
    session.complainantName = session.complainantName || existing.complainantName;
    session.officerLabel = session.officerLabel || existing.officerLabel;
    session.officerUnknown = session.officerUnknown || existing.officerUnknown;
    session.timeLabel = session.timeLabel || existing.timeLabel;
    session.evidenceStatus = session.evidenceStatus || existing.evidenceStatus;
    session.evidenceMentionedWithoutFile = session.evidenceMentionedWithoutFile || existing.evidenceMentionedWithoutFile;
    session.narrativeMessages = [...new Set([...existing.narrativeMessages, ...session.narrativeMessages])].slice(-6);
  }

  triageSessions.set(channelId, session);
  return session;
}

async function buildConversationContext(channel, ticket, actorInfo, currentMessage, mode) {
  const historyLimit = mode === 'citizen_triage' ? 100 : getMaxHistory();
  const messages = await channel.messages.fetch({ limit: historyLimit }).catch(() => null);
  const history = messages
    ? [...messages.values()].reverse()
    : [currentMessage];
  if (!history.some((message) => message.id === currentMessage.id)) {
    history.push(currentMessage);
  }
  const triageState = mode === 'citizen_triage'
    ? rebuildTriageSessionFromHistory(channel.id, ticket, history)
    : null;
  const triage = triageState
    ? buildTriageSnapshotFromSession(triageState)
    : buildTriageState(history, ticket, channel);

  const lines = history
    .filter((message) => !message.system)
    .map((message) => {
      const isBot = message.author.id === channel.client.user.id;
      const isCurrent = message.id === currentMessage.id;
      const authorType = isBot
        ? 'ASSISTENTE_IA'
        : message.author.id === ticket.userId
          ? 'USUÁRIO'
          : 'STAFF/PARTICIPANTE';

      return `${isCurrent ? '[MENSAGEM ATUAL] ' : ''}${authorType} ${message.author.username}: ${getMessageText(message)}`;
    })
    .slice(-getMaxHistory());

  const currentText = mode === 'staff_prompt'
    ? stripAiTrigger(currentMessage) || getMessageText(currentMessage)
    : getMessageText(currentMessage);
  const departmentLabel = normalizeDepartmentLabel(ticket.reason);

  const input = [
    `Departamento do ticket: ${departmentLabel}`,
    `Dono do ticket: ${ticket.username || ticket.userId}`,
    `Ticket assumido por responsável: ${ticket.claimedBy ? 'sim' : 'não'}`,
    `Autor da mensagem atual: ${actorInfo.displayName} (${roleLabel(actorInfo.type)})`,
    `Modo de resposta: ${mode}`,
    '',
    'Dados já coletados:',
    triage.collected.length ? triage.collected.join('\n') : 'Nenhum dado essencial identificado ainda.',
    '',
    'Dados que ainda faltam:',
    triage.complete ? 'Nenhum dado essencial. A triagem básica está completa.' : triage.missing.join('\n'),
    '',
    'Regra de resposta para esta mensagem:',
    triage.complete
      ? 'Não faça novas perguntas. Agradeça, resuma brevemente e diga que um responsável humano dará continuidade.'
      : `Peça somente o primeiro item faltante: ${triage.missing[0] || 'detalhes relevantes'}. Não repita perguntas sobre dados já coletados.`,
    '',
    'Histórico recente:',
    lines.join('\n') || 'Sem histórico disponível.',
    '',
    `Mensagem que você deve responder agora: ${currentText}`,
  ].join('\n');

  return {
    input,
    triage,
    triageState,
    history,
  };
}

function buildCitizenTriageReply(context, ticket) {
  const firstMissing = context.triage.missing[0];
  const displayName = ticket.username || 'cidadão';

  if (context.triage.complete) {
    return `Perfeito, ${displayName}. Recebi os dados básicos informados e acionei a equipe responsável.\n\nA triagem automática foi encerrada. Aguarde um responsável humano dar continuidade ao atendimento.`;
  }

  if (firstMissing === MISSING_COMPLAINANT_NAME) {
    return 'Para seguir, informe apenas seu nome completo. Se preferir manter anonimo, responda apenas: anonimo.';
  }

  if (firstMissing === MISSING_OFFICER_ID) {
    return 'Agora, informe apenas a badge, nome e sobrenome do oficial denunciado. Exemplo: [524] - John Smith.';
  }

  if (firstMissing === MISSING_TIME) {
    return 'Agora, informe apenas o horário aproximado do ocorrido.';
  }

  if (firstMissing === MISSING_EVIDENCE_FILE) {
    return 'Você mencionou uma prova. Envie apenas o arquivo ou link da imagem/vídeo, por favor.';
  }

  return 'Por fim, envie apenas a prova em arquivo ou link de imagem/vídeo. Se não tiver prova, diga que não possui.';
}

function extractOutputText(responseBody) {
  const parts = [];
  for (const candidate of responseBody.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (typeof part.text === 'string') parts.push(part.text);
    }
  }

  return parts.join('\n').trim();
}

async function callGeminiModel(input, model) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${GEMINI_GENERATE_URL}/${encodeURIComponent(model)}:generateContent`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildInstructions() }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: input }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 450,
          temperature: 0.35,
          topP: 0.9,
        },
      }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const details = body?.error?.message || `HTTP ${response.status}`;
      throw new Error(details);
    }

    const text = extractOutputText(body);
    if (!text) {
      const blockReason = body?.promptFeedback?.blockReason;
      throw new Error(blockReason ? `Resposta bloqueada pelo Gemini: ${blockReason}` : 'Resposta do Gemini sem texto.');
    }

    return truncate(text, MAX_DISCORD_MESSAGE_LENGTH);
  } finally {
    clearTimeout(timeout);
  }
}

async function createGeminiResponse(input) {
  let lastError = null;

  for (const [index, model] of getFallbackModels().entries()) {
    try {
      if (index > 0) {
        logger.warn(`Tentando modelo Gemini alternativo: ${model}`);
      }

      return await callGeminiModel(input, model);
    } catch (error) {
      lastError = error;
      if (!shouldTryNextModel(error)) break;
      await sleep(700);
    }
  }

  throw lastError || new Error('Gemini indisponível.');
}

function collectTicketEvidence(history, ticket, clientUserId) {
  const evidence = [];

  for (const message of history) {
    if (message.system || message.author.id !== ticket.userId || message.author.id === clientUserId) continue;

    for (const attachment of message.attachments?.values?.() || []) {
      evidence.push({
        type: getEvidenceTypeFromAttachment(attachment),
        name: attachment.name || attachment.id || 'arquivo',
        url: attachment.url,
      });
    }

    const mentionsEvidence = textIncludesAny(String(message.content || ''), EVIDENCE_WORD_PATTERNS);
    for (const url of extractUrls(message.content)) {
      const type = getEvidenceTypeFromUrl(url);
      if (type === 'imagem' || type === 'video' || mentionsEvidence) {
        evidence.push({
          type,
          name: type === 'link' ? 'link informado pelo usuário' : url,
          url,
        });
      }
    }
  }

  return evidence.slice(0, MAX_REPORT_ATTACHMENT_ITEMS);
}

function getTicketUserMessages(history, ticket, clientUserId) {
  return history
    .filter((message) => !message.system && message.author.id === ticket.userId && message.author.id !== clientUserId)
    .map((message) => ({
      text: getMessageText(message),
      cleanText: normalizeForDetection(getMessageText(message)),
      hasAttachment: Boolean(message.attachments?.size),
    }));
}

function cleanReportValue(text, max = 180) {
  const value = normalizeForDetection(text)
    .replace(/\s*,\s*(denunci|denunciar|denuncia).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return truncate(value || 'N/A', max);
}

function extractComplainantName(userMessages) {
  for (const item of userMessages) {
    const text = item.cleanText;
    if (isAnonymousAnswer(text)) return 'Anonimo';
    const explicit = text.match(/\b(?:meu\s+nome\s+(?:e|eh|é)|sou|nome)\s*:?\s*([a-zA-ZÀ-ÿ]{2,}(?:\s+[a-zA-ZÀ-ÿ]{2,}){1,4})/i);
    if (explicit) return cleanReportValue(explicit[1]);

    const beforeComplaint = text.match(/^([a-zA-ZÀ-ÿ]{2,}(?:\s+[a-zA-ZÀ-ÿ]{2,}){1,4})\s*,\s*(?:denunci|denunciar|denuncia)/i);
    if (beforeComplaint) return cleanReportValue(beforeComplaint[1]);

    if (isLikelyNameText(text)) return cleanReportValue(text);
  }

  return 'Não informado';
}

function extractOfficerIdentification(userMessages) {
  const explicitPatterns = [
    /\b(?:oficial|policial|agente)\s+(?!denunciado\b|envolvido\b|me\b|que\b|um\b|uma\b|o\b|a\b|matou\b|atirou\b|prendeu\b|abordou\b)([a-zA-ZÀ-ÿ0-9]{2,}(?:\s+[a-zA-ZÀ-ÿ0-9]{2,}){0,4})/i,
    /^([a-zA-ZÀ-ÿ]{2,}(?:\s+[a-zA-ZÀ-ÿ]{2,}){0,4}\s+\d{1,8})\b/i,
    /\bdenunci(?:ar|a)?\s+(?!um\b|uma\b|o\b|a\b|oficial\b|policial\b)([a-zA-ZÀ-ÿ]{2,}(?:\s+[a-zA-ZÀ-ÿ]{2,}){1,4})/i,
  ];

  for (const item of userMessages) {
    const text = item.cleanText;
    for (const pattern of explicitPatterns) {
      const match = text.match(pattern);
      if (match) return cleanReportValue(match[1]);
    }
  }

  const complainantIndex = userMessages.findIndex((item) => hasComplainantName([item]));
  if (complainantIndex >= 0) {
    for (const item of userMessages.slice(complainantIndex + 1)) {
      if (isLikelyNameText(item.cleanText, { allowDigits: true })) {
        return cleanReportValue(item.cleanText);
      }
      if (isUnknownAnswer(item.cleanText)) {
        return 'Não informado pelo usuário';
      }
    }
  }

  return 'Não informado';
}

function extractTimeLabel(userMessages) {
  const patterns = [
    /\b\d{1,2}:\d{2}\b/i,
    /\b\d{1,2}\s*(?:h|horas?|hrs?)\b/i,
    /\b(?:hoje|agora|ontem)\b/i,
  ];

  for (const item of userMessages) {
    for (const pattern of patterns) {
      const match = item.cleanText.match(pattern);
      if (match) return cleanReportValue(match[0], 80);
    }
  }

  return 'Não informado';
}

function buildNarrative(userMessages) {
  const narrativeMessages = userMessages
    .map((item) => item.cleanText)
    .filter((text) => {
      if (!text) return false;
      if (isUnknownAnswer(text)) return false;
      if (isLikelyNameText(text, { allowDigits: true })) return false;
      if (isTimeOnlyText(text) && text.length <= 30) return false;
      if (textIncludesAny(text, EVIDENCE_WORD_PATTERNS) && text.length <= 40) return false;
      return true;
    })
    .map((text) => cleanReportValue(text, 280));

  return narrativeMessages.length
    ? narrativeMessages.join(' | ')
    : 'Não detalhado na triagem automática.';
}

function formatEvidenceLines(evidence, triage) {
  if (!evidence.length) {
    return triage.collected.some((item) => normalizeLoose(item).includes('nao possui'))
      ? ['Usuário informou que não possui prova.']
      : ['Nenhuma mídia ou anexo identificado.'];
  }

  return evidence.map((item) => {
    const label = item.type === 'imagem'
      ? 'Imagem'
      : item.type === 'video'
        ? 'Vídeo'
        : item.type === 'link'
          ? 'Link'
          : 'Anexo';

    const name = truncate(item.name || 'arquivo', 90);
    return item.url ? `${label}: [${name}](${item.url})` : `${label}: ${name}`;
  });
}

function buildCompletionReportData(context, ticket, channel, target) {
  const userMessages = getTicketUserMessages(context.history, ticket, channel.client.user.id);
  const evidence = collectTicketEvidence(context.history, ticket, channel.client.user.id);
  const state = context.triageState;
  const officerLabel = state?.officerLabel
    || (state?.officerUnknown ? 'Não informado pelo usuário' : extractOfficerIdentification(userMessages));
  const attentionLines = ['Validar relato e provas antes de qualquer medida administrativa.'];

  if (normalizeLoose(officerLabel).includes('nao informado')) {
    attentionLines.unshift('Usuario nao soube informar a badge, nome e sobrenome do oficial; validar pela prova anexada ou pelo historico.');
  }

  return {
    targetMention: target.mention,
    allowedMentions: target.allowedMentions,
    citizenLabel: ticket.username || ticket.userId,
    departmentName: normalizeDepartmentLabel(ticket.reason),
    complainantName: state?.complainantName || extractComplainantName(userMessages),
    officerLabel,
    timeLabel: state?.timeLabel || extractTimeLabel(userMessages),
    narrative: state?.narrativeMessages?.length ? state.narrativeMessages.join(' | ') : buildNarrative(userMessages),
    evidenceLines: formatEvidenceLines(evidence, context.triage),
    attentionLines,
  };
}

function buildReportHistory(history, ticket, clientUserId) {
  return history
    .filter((message) => !message.system && message.author.id !== clientUserId)
    .map((message) => {
      const authorType = message.author.id === ticket.userId ? 'USUÁRIO' : 'STAFF/PARTICIPANTE';
      return `${authorType} ${message.author.username}: ${getMessageText(message)}`;
    })
    .slice(-getMaxHistory())
    .join('\n');
}

function buildCompletionReportPrompt(context, ticket, channel) {
  const evidence = collectTicketEvidence(context.history, ticket, channel.client.user.id);
  const evidenceSummary = evidence.length
    ? evidence.map((item) => `${item.type}: ${item.name}`).join('\n')
    : 'Nenhuma mídia/anexo do usuário identificado no histórico.';

  return [
    'Gere um relatório interno para o responsável do ticket.',
    'Use somente o histórico abaixo. Não invente fatos, nomes, horários ou provas.',
    'Escreva em português do Brasil, com tom policial administrativo, claro e objetivo.',
    'Não use ping real de usuário ou cargo. Não inclua links de anexos, pois eles serão adicionados automaticamente.',
    'Formato desejado:',
    '**Resumo do relato:** 2 a 4 frases.',
    '**Dados coletados:** lista curta com identificacao do denunciante, oficial denunciado, horario aproximado e provas.',
    '**Atenção:** pontos que o responsável precisa validar.',
    '',
    `Departamento: ${normalizeDepartmentLabel(ticket.reason)}`,
    `Usuário: ${ticket.username || ticket.userId}`,
    '',
    'Estado da triagem:',
    context.triage.collected.join('\n') || 'Sem dados coletados.',
    '',
    'Mídias/anexos detectados:',
    evidenceSummary,
    '',
    'Histórico:',
    buildReportHistory(context.history, ticket, channel.client.user.id) || 'Sem histórico disponível.',
  ].join('\n');
}

function formatEvidenceForReport(evidence) {
  if (!evidence.length) {
    return '**Mídias e anexos:** Nenhum arquivo/link de imagem ou vídeo foi anexado pelo usuário.';
  }

  const lines = evidence.map((item) => {
    const label = item.type === 'imagem'
      ? 'Imagem'
      : item.type === 'video'
        ? 'Vídeo'
        : item.type === 'link'
          ? 'Link'
          : 'Anexo';
    return `- ${label}: ${truncate(item.name, 70)}${item.url ? ` - ${item.url}` : ''}`;
  });

  return ['**Mídias e anexos do usuário:**', ...lines].join('\n');
}

async function getCompletionReportTarget(channel, ticket) {
  if (ticket.claimedBy) {
    return {
      mention: `<@${ticket.claimedBy}>`,
      allowedMentions: { users: [ticket.claimedBy], roles: [], repliedUser: false },
    };
  }

  const staffRoleId = await getStaffRoleId(channel.guild);
  if (staffRoleId) {
    return {
      mention: `<@&${staffRoleId}>`,
      allowedMentions: { users: [], roles: [staffRoleId], repliedUser: false },
    };
  }

  return {
    mention: '**Equipe responsável**',
    allowedMentions: { users: [], roles: [], repliedUser: false },
  };
}

function buildCompletionReportContent(target, ticket, reportText, evidence) {
  const content = [
    `${target.mention} **Triagem completa deste ticket.**`,
    '',
    `**Cidadão:** ${ticket.username || ticket.userId}`,
    '',
    reportText,
    '',
    formatEvidenceForReport(evidence),
    '',
    '**Próximo passo:** validar o relato/provas e assumir a continuidade do atendimento.',
  ].join('\n');

  return truncate(content, MAX_DISCORD_MESSAGE_LENGTH);
}

async function sendCompletionReportIfReady(channel, ticket, context, actorInfo) {
  if (!isCompletionReportEnabled()) return;
  if (actorInfo.isResponsible) return;
  if (!context.triage.complete || context.triage.missing.length) return;
  if (sentCompletionReports.has(channel.id)) return;

  const key = `report:${channel.id}`;
  if (activeRequests.has(key)) return;
  activeRequests.add(key);

  try {
    const target = await getCompletionReportTarget(channel, ticket);
    const reportData = buildCompletionReportData(context, ticket, channel, target);

    await channel.send(componentFactory.createTicketAiReportPayload(reportData));

    sentCompletionReports.add(channel.id);
  } catch (error) {
    logger.warn(`IA não conseguiu gerar o relatório final do ticket ${channel.id}: ${error.message}`);
  } finally {
    activeRequests.delete(key);
  }
}

function canSendFailureNotice(channelId) {
  const last = lastFailureNoticeAt.get(channelId) || 0;
  if (Date.now() - last < 120000) return false;

  lastFailureNoticeAt.set(channelId, Date.now());
  return true;
}

async function sendUnavailableNotice(channel, message = null) {
  if (!canSendFailureNotice(channel.id)) return;

  const payload = {
    content: 'A assistente virtual está indisponível no momento. Um responsável humano seguirá com o atendimento.',
    allowedMentions: { users: [], roles: [], repliedUser: false },
  };

  if (message) {
    await message.reply(payload).catch(() => null);
    return;
  }

  await channel.send(payload).catch(() => null);
}

async function sendOpeningPrompt(channel, ticket) {
  if (!isEnabled() || !ticket) return;
  if (!isTicketAiAllowed(ticket)) return;

  const key = `opening:${channel.id}`;
  if (activeRequests.has(key)) return;
  activeRequests.add(key);
  triageSessions.set(channel.id, createTriageSession(ticket, channel.id));

  try {
    await channel.sendTyping().catch(() => null);

    await channel.send({
      content: `Ola, ${ticket.username || 'cidadao'}! Sou a assistente virtual da SSP e vou adiantar a triagem com perguntas rapidas.\n\nPara comecar, informe apenas seu nome completo. Se preferir manter anonimo, responda apenas: anonimo.`,
      allowedMentions: { users: [], roles: [], repliedUser: false },
    });
  } catch (error) {
    logger.warn(`IA de ticket indisponível na abertura: ${error.message}`);
    await sendUnavailableNotice(channel);
  } finally {
    activeRequests.delete(key);
  }
}

async function handleTicketMessage(message) {
  if (!isEnabled()) return;
  if (!message.guild || message.author.bot || !message.channel) return;

  const ticket = await ticketsService.getTicketByChannel(message.channel.id);
  if (!ticket) return;
  if (!isTicketAiAllowed(ticket)) return;

  const actorInfo = await getActorInfo(message, ticket);
  const triggered = isAiTriggered(message);
  const mode = actorInfo.isResponsible ? 'staff_prompt' : 'citizen_triage';

  if (actorInfo.isResponsible && !triggered) return;
  if (!actorInfo.isResponsible && sentCompletionReports.has(message.channel.id)) return;
  if (!actorInfo.isResponsible && ticket.claimedBy && !triggered && (!isCompletionReportEnabled() || sentCompletionReports.has(message.channel.id))) return;

  const key = `message:${message.channel.id}`;
  const usesGemini = actorInfo.isResponsible;

  if (usesGemini) {
    if (!triggered && !canAutoReply(message.channel.id)) return;
    if (activeRequests.has(key)) return;
    activeRequests.add(key);
  }

  try {
    await message.channel.sendTyping().catch(() => null);
    const context = await buildConversationContext(message.channel, ticket, actorInfo, message, mode);
    const answer = usesGemini
      ? await createGeminiResponse(context.input)
      : buildCitizenTriageReply(context, ticket);

    await message.reply({
      content: answer,
      allowedMentions: { users: [], roles: [], repliedUser: false },
    });

    await sendCompletionReportIfReady(message.channel, ticket, context, actorInfo);
  } catch (error) {
    logger.warn(`IA de ticket não respondeu em ${message.channel.id}: ${error.message}`);
    await sendUnavailableNotice(message.channel, message);
  } finally {
    if (usesGemini) activeRequests.delete(key);
  }
}

module.exports = {
  isEnabled,
  sendOpeningPrompt,
  handleTicketMessage,
};
