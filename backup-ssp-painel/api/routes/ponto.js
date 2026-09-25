const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const Ponto = require('../../models/Ponto');
const { requireAdmin } = require('../middlewares/auth');
const { notifyPontoDiscord, calculatePontoDurationMs } = require('../utils/discord');
const { registrarAuditLog, panelOnlyActionDisabled } = require('../utils/helpers');

// Listar pontos
router.get('/ponto', async (req, res) => {
    try {
        const { q, status, startDate, endDate, userId, roleId, corporationSlug } = req.query;
        let query = {};
        if (status) query.status = status;
        if (corporationSlug) query.corporationSlug = corporationSlug;

        if (roleId) {
            const guildId = process.env.GUILD_ID;
            let guildMembers = [];
            try {
                const { discordAPIRequest } = require('../utils/discord');
                guildMembers = await discordAPIRequest(`/guilds/${guildId}/members?limit=1000`, 'GET');
            } catch (discordErr) {
                console.error('[Ponto API] Erro ao buscar membros do Discord para filtro de cargo:', discordErr.message);
            }
            if (Array.isArray(guildMembers)) {
                const filteredUserIds = guildMembers
                    .filter(m => m.roles && m.roles.includes(roleId))
                    .map(m => m.user.id);
                
                if (userId) {
                    query.userId = filteredUserIds.includes(userId) ? userId : 'none';
                } else {
                    query.userId = { $in: filteredUserIds };
                }
            } else {
                if (userId) query.userId = userId;
            }
        } else if (userId) {
            query.userId = userId;
        }

        if (startDate || endDate) {
            query.entrada = {};
            if (startDate) query.entrada.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.entrada.$lte = end;
            }
        }
        if (q) {
            query.$or = [
                { username: { $regex: q, $options: 'i' } },
                { userId: { $regex: q, $options: 'i' } }
            ];
        }

        const { discordAPIRequest } = require('../utils/discord');
        const guildId = process.env.GUILD_ID;
        let guildRoles = [];
        try {
            guildRoles = await discordAPIRequest(`/guilds/${guildId}/roles`, 'GET');
        } catch (err) {
            console.error('[Ponto API] Erro ao buscar roles do Discord:', err.message);
        }

        const rolesList = Array.isArray(guildRoles) 
            ? guildRoles.filter(r => r.name !== '@everyone' && !r.managed && r.name.includes('┃'))
            : [];

        const pontos = await Ponto.find(query).sort({ entrada: -1 }).lean();
        res.json({ success: true, pontos, roles: rolesList });
    } catch (error) {
        console.error("Erro em /api/ponto:", error);
        res.status(500).json({ success: false, message: 'Erro ao buscar registros de ponto.' });
    }
});

// Estatísticas de ponto e ranking de oficiais
router.get('/ponto/stats', async (req, res) => {
    try {
        const { corporationSlug } = req.query;
        const matchFilter = { status: 'fechado' };
        if (corporationSlug) matchFilter.corporationSlug = corporationSlug;

        const activeFilter = { status: 'aberto' };
        if (corporationSlug) activeFilter.corporationSlug = corporationSlug;

        const activeOfficers = await Ponto.countDocuments(activeFilter);
        const totalPatrolResult = await Ponto.aggregate([
            { $match: matchFilter },
            { $group: { _id: null, totalMs: { $sum: '$durationMs' } } }
        ]);
        const totalPatrolMs = totalPatrolResult[0]?.totalMs || 0;

        const ranking = await Ponto.aggregate([
            { $match: matchFilter },
            {
                $group: {
                    _id: '$userId',
                    username: { $first: '$username' },
                    totalMs: { $sum: '$durationMs' },
                    shiftsCount: { $sum: 1 }
                }
            },
            { $sort: { totalMs: -1 } },
            { $limit: 10 }
        ]);

        res.json({
            success: true,
            activeOfficers,
            totalPatrolTimeHours: Math.round(totalPatrolMs / (1000 * 60 * 60) * 100) / 100,
            ranking
        });
    } catch (error) {
        console.error("Erro em /api/ponto/stats:", error);
        res.status(500).json({ success: false, message: 'Erro ao carregar estatísticas de ponto.' });
    }
});

// Estatísticas avançadas com filtros de período, corporação e patente
router.get('/ponto/stats/advanced', async (req, res) => {
    try {
        const { period, startDate, endDate, corporationSlug, roleId } = req.query;

        // 1. Construir filtro de data baseado no período
        const now = new Date();
        let dateFilter = {};

        if (period === 'today') {
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);
            dateFilter = { $gte: todayStart };
        } else if (period === 'week') {
            const weekStart = new Date(now);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // domingo
            weekStart.setHours(0, 0, 0, 0);
            dateFilter = { $gte: weekStart };
        } else if (period === 'month') {
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            dateFilter = { $gte: monthStart };
        } else if (period === 'custom' && startDate) {
            dateFilter.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                dateFilter.$lte = end;
            }
        }
        // period === 'all' ou undefined → sem filtro de data

        // 2. Construir match filter base
        const matchFilter = { status: 'fechado' };
        if (Object.keys(dateFilter).length > 0) matchFilter.entrada = dateFilter;
        if (corporationSlug) matchFilter.corporationSlug = corporationSlug;

        // 3. Filtrar por roleId (patente) se fornecido — busca membros com essa role no Discord
        let roleFilteredUserIds = null;
        if (roleId) {
            const guildId = process.env.GUILD_ID;
            try {
                const { discordAPIRequest } = require('../utils/discord');
                const guildMembers = await discordAPIRequest(`/guilds/${guildId}/members?limit=1000`, 'GET');
                if (Array.isArray(guildMembers)) {
                    roleFilteredUserIds = guildMembers
                        .filter(m => m.roles && m.roles.includes(roleId))
                        .map(m => m.user.id);
                }
            } catch (err) {
                console.error('[Stats Advanced] Erro ao buscar membros para filtro de patente:', err.message);
            }
            if (roleFilteredUserIds) {
                matchFilter.userId = { $in: roleFilteredUserIds };
            }
        }

        // 4. Ranking Top 15
        const ranking = await Ponto.aggregate([
            { $match: matchFilter },
            {
                $group: {
                    _id: '$userId',
                    username: { $last: '$username' },
                    totalMs: { $sum: '$durationMs' },
                    shiftsCount: { $sum: 1 }
                }
            },
            { $sort: { totalMs: -1 } },
            { $limit: 15 }
        ]);

        // Buscar avatares dos membros do ranking
        const Member = require('../../models/Member');
        const rankUserIds = ranking.map(r => r._id);
        const membersData = await Member.find({ discordUserId: { $in: rankUserIds } }, 'discordUserId avatarUrl').lean();
        const avatarMap = {};
        membersData.forEach(m => { avatarMap[m.discordUserId] = m.avatarUrl; });

        const rankingWithAvatars = ranking.map(r => ({
            userId: r._id,
            username: r.username,
            totalMs: r.totalMs,
            totalHours: Math.round(r.totalMs / (1000 * 60 * 60) * 10) / 10,
            shiftsCount: r.shiftsCount,
            avatarUrl: avatarMap[r._id] || null
        }));

        // 5. Stats gerais do período
        const statsAgg = await Ponto.aggregate([
            { $match: matchFilter },
            {
                $group: {
                    _id: null,
                    totalMs: { $sum: '$durationMs' },
                    totalShifts: { $sum: 1 },
                    uniqueOfficers: { $addToSet: '$userId' }
                }
            }
        ]);

        const totalMs = statsAgg[0]?.totalMs || 0;
        const totalShifts = statsAgg[0]?.totalShifts || 0;
        const uniqueOfficers = statsAgg[0]?.uniqueOfficers?.length || 0;
        const avgHoursPerOfficer = uniqueOfficers > 0
            ? Math.round((totalMs / (1000 * 60 * 60)) / uniqueOfficers * 10) / 10
            : 0;

        // Oficiais em serviço (ponto aberto agora)
        const activeFilter = { status: 'aberto' };
        if (corporationSlug) activeFilter.corporationSlug = corporationSlug;
        const activeOfficers = await Ponto.countDocuments(activeFilter);

        // 6. Breakdown por corporação
        const corpMatchFilter = { status: 'fechado' };
        if (Object.keys(dateFilter).length > 0) corpMatchFilter.entrada = dateFilter;
        if (roleFilteredUserIds) corpMatchFilter.userId = { $in: roleFilteredUserIds };

        const corpBreakdown = await Ponto.aggregate([
            { $match: corpMatchFilter },
            {
                $group: {
                    _id: '$corporationSlug',
                    totalMs: { $sum: '$durationMs' },
                    shiftsCount: { $sum: 1 },
                    uniqueOfficers: { $addToSet: '$userId' }
                }
            },
            { $sort: { totalMs: -1 } }
        ]);

        const corpBreakdownFormatted = corpBreakdown.map(c => ({
            slug: c._id || 'pmesp',
            totalHours: Math.round(c.totalMs / (1000 * 60 * 60) * 10) / 10,
            totalMs: c.totalMs,
            shiftsCount: c.shiftsCount,
            officersCount: c.uniqueOfficers?.length || 0
        }));

        // 7. Atividade diária (últimos N dias baseado no período)
        let daysBack = 7;
        if (period === 'month') daysBack = 30;
        else if (period === 'today') daysBack = 1;
        else if (period === 'all') daysBack = 30;
        else if (period === 'custom' && startDate && endDate) {
            daysBack = Math.min(Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1, 60);
        }

        const dailyStart = new Date(now);
        dailyStart.setDate(dailyStart.getDate() - daysBack + 1);
        dailyStart.setHours(0, 0, 0, 0);

        const dailyMatchFilter = { status: 'fechado', entrada: { $gte: dailyStart } };
        if (corporationSlug) dailyMatchFilter.corporationSlug = corporationSlug;
        if (roleFilteredUserIds) dailyMatchFilter.userId = { $in: roleFilteredUserIds };

        const dailyActivity = await Ponto.aggregate([
            { $match: dailyMatchFilter },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: '$entrada',
                            timezone: 'America/Sao_Paulo'
                        }
                    },
                    totalMs: { $sum: '$durationMs' },
                    shiftsCount: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Preencher dias sem atividade com 0
        const dailyMap = {};
        for (let i = 0; i < daysBack; i++) {
            const d = new Date(dailyStart);
            d.setDate(d.getDate() + i);
            const key = d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10);
            dailyMap[key] = { hours: 0, shifts: 0 };
        }
        dailyActivity.forEach(d => {
            if (dailyMap[d._id]) {
                dailyMap[d._id].hours = Math.round(d.totalMs / (1000 * 60 * 60) * 10) / 10;
                dailyMap[d._id].shifts = d.shiftsCount;
            }
        });

        // 8. Buscar roles do Discord para filtro de patente
        const { discordAPIRequest } = require('../utils/discord');
        const guildId = process.env.GUILD_ID;
        let rolesList = [];
        try {
            const guildRoles = await discordAPIRequest(`/guilds/${guildId}/roles`, 'GET');
            rolesList = Array.isArray(guildRoles)
                ? guildRoles.filter(r => r.name !== '@everyone' && !r.managed && r.name.includes('┃'))
                : [];
        } catch (err) {
            console.error('[Stats Advanced] Erro ao buscar roles:', err.message);
        }

        res.json({
            success: true,
            period: period || 'all',
            periodStats: {
                totalHours: Math.round(totalMs / (1000 * 60 * 60) * 10) / 10,
                totalMs,
                totalShifts,
                uniqueOfficers,
                avgHoursPerOfficer,
                activeOfficers
            },
            ranking: rankingWithAvatars,
            corpBreakdown: corpBreakdownFormatted,
            dailyActivity: dailyMap,
            roles: rolesList
        });
    } catch (error) {
        console.error("Erro em /api/ponto/stats/advanced:", error);
        res.status(500).json({ success: false, message: 'Erro ao carregar estatísticas avançadas.' });
    }
});

// Criar ponto manual (desativado)
router.post('/ponto', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Criar ponto manual');
});

// Editar ponto (desativado)
router.put('/ponto/:id([0-9a-fA-F]{24})', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Editar ponto');
});

// Fechar ponto manualmente (desativado)
router.put('/ponto/:id([0-9a-fA-F]{24})/close', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Fechar ponto de outro oficial');
});

// Deletar ponto (desativado)
router.delete('/ponto/:id([0-9a-fA-F]{24})', requireAdmin, async (req, res) => {
    return panelOnlyActionDisabled(res, 'Excluir ponto');
});

// Exportar pontos em PDF/Excel
router.get('/ponto/export', async (req, res) => {
    try {
        const { format, q, status, startDate, endDate, userId, roleId, corporationSlug } = req.query;
        let query = {};
        if (status) query.status = status;
        if (corporationSlug) query.corporationSlug = corporationSlug;

        if (roleId) {
            const guildId = process.env.GUILD_ID;
            let guildMembers = [];
            try {
                const { discordAPIRequest } = require('../utils/discord');
                guildMembers = await discordAPIRequest(`/guilds/${guildId}/members?limit=1000`, 'GET');
            } catch (discordErr) {
                console.error('[Ponto API Export] Erro ao buscar membros do Discord para filtro de cargo:', discordErr.message);
            }
            if (Array.isArray(guildMembers)) {
                const filteredUserIds = guildMembers
                    .filter(m => m.roles && m.roles.includes(roleId))
                    .map(m => m.user.id);
                
                if (userId) {
                    query.userId = filteredUserIds.includes(userId) ? userId : 'none';
                } else {
                    query.userId = { $in: filteredUserIds };
                }
            } else {
                if (userId) query.userId = userId;
            }
        } else if (userId) {
            query.userId = userId;
        }

        if (startDate || endDate) {
            query.entrada = {};
            if (startDate) query.entrada.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.entrada.$lte = end;
            }
        }
        if (q) {
            query.$or = [
                { username: { $regex: q, $options: 'i' } },
                { userId: { $regex: q, $options: 'i' } }
            ];
        }
        const pontos = await Ponto.find(query).sort({ entrada: -1 }).lean();
        if (['xlsx', 'pdf'].includes(format)) {
            await registrarAuditLog(
                'relatorio_exportado',
                'Relatório de Ponto Exportado',
                `${req.session.user.displayName} exportou o relatório de ponto no formato ${format.toUpperCase()}.`,
                req.session.user.id,
                req.session.user.username,
                { relatorio: 'ponto', formato: format, total: pontos.length, status: status || '', inicio: startDate || '', fim: endDate || '', filtro: q || '' }
            );
        }

        if (format === 'xlsx') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Registros de Ponto SSP');
            worksheet.columns = [
                { header: 'Policial', key: 'username', width: 25 },
                { header: 'Discord ID', key: 'userId', width: 25 },
                { header: 'Entrada', key: 'entrada', width: 25 },
                { header: 'Saída', key: 'saida', width: 25 },
                { header: 'Duração (Horas)', key: 'durationHours', width: 18 },
                { header: 'Status', key: 'status', width: 15 }
            ];
            pontos.forEach(p => {
                const durationHours = p.status === 'fechado' 
                    ? Math.round(p.durationMs / (1000 * 60 * 60) * 100) / 100 
                      : 0;
                worksheet.addRow({
                    username: p.username,
                    userId: p.userId,
                    entrada: new Date(p.entrada).toLocaleString('pt-BR'),
                    saida: p.saida ? new Date(p.saida).toLocaleString('pt-BR') : 'Em patrulha',
                    durationHours,
                    status: p.status === 'aberto' ? 'Aberto' : 'Fechado'
                });
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="pontos-ssp.xlsx"');
            await workbook.xlsx.write(res);
            return res.end();
        } else if (format === 'pdf') {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="pontos-ssp.pdf"');
            doc.pipe(res);

            doc.fontSize(18).text('SSP - Relatório de Registros de Bate-Ponto', { align: 'center' });
            doc.moveDown(2);

            pontos.forEach((p, index) => {
                const durationHours = p.status === 'fechado' 
                    ? Math.round(p.durationMs / (1000 * 60 * 60) * 100) / 100 
                    : 0;
                const saidaStr = p.saida ? new Date(p.saida).toLocaleString('pt-BR') : 'Em patrulha';

                doc.fontSize(10).text(
                    `${index + 1}. Policial: ${p.username} (${p.userId})\n` +
                    `   Entrada: ${new Date(p.entrada).toLocaleString('pt-BR')} | Saída: ${saidaStr}\n` +
                    `   Duração: ${durationHours} Horas | Status: ${p.status.toUpperCase()}\n`,
                    { lineGap: 4 }
                );
                doc.lineCap('round').moveTo(doc.x, doc.y).lineTo(565, doc.y).strokeColor("#dddddd").stroke();
                doc.moveDown();
            });

            doc.end();
        } else {
            res.status(400).send('Formato inválido.');
        }
    } catch (e) {
        console.error("Erro na exportação de pontos:", e);
        res.status(500).send('Erro ao gerar relatório.');
    }
});

module.exports = router;
