const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001;

// DB - read-write for config support
const DB_PATH = path.join(__dirname, 'servo-cable.db');
const db = new Database(DB_PATH);

function getClientIp(req) {
    var fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',')[0].trim();
    var real = req.headers['x-real-ip'];
    if (real) return real;
    if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
    return 'unknown';
}

// 初始化 config 表
function initConfig() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data TEXT NOT NULL
        );
    `);
    const row = db.prepare('SELECT data FROM config WHERE id = 1').get();
    if (!row) {
        const defaultConfig = {
            limitEnabled: false,
            freeQueries: 1,
            wechatId: 'zzh250058',
            unlockCodes: ['KZY2024', 'SERVO888', 'CABLE666'],
            siteTitle: '伺服电缆选型工具',
            siteSubtitle: '基于实际电缆数据库，智能匹配安川伺服电机电缆型号',
            modalTitle: '查询次数已用完',
            modalText: '您已使用完免费查询次数。\n添加客服微信，获取解锁码后即可无限查询。',
            unlockSuccess: '🎉 解锁成功！您现在可以无限查询了。',
            tipsText: '支持完整型号（如 SGMXA-09AUA61C2）和短代码（如 SGMXA-09/13）搜索\n左右分栏展示电机电缆和编码器电缆，无需频繁上下滚动\n电机电缆根据型号自动匹配（61C2=无抱闸，6CC2=带抱闸）\n编码器电缆显示该电机所有可选类型（无电池/带电池），供用户自选\n免费查询1次，添加客服微信可解锁无限查询',
            adminPassword: 'kzy2024'
        };
        db.prepare('INSERT INTO config (id, data) VALUES (1, ?)').run(JSON.stringify(defaultConfig));
    }
}

function getConfig() {
    try {
        const row = db.prepare('SELECT data FROM config WHERE id = 1').get();
        return row ? JSON.parse(row.data) : {};
    } catch (e) {
        return {};
    }
}

function saveConfig(data) {
    // 合并现有配置
    const current = getConfig();
    const merged = { ...current, ...data };
    db.prepare('INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)').run(JSON.stringify(merged));
}

// 初始化
initConfig();

app.use(cors());

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// ========== CONFIG API ==========

// 获取配置（公开，所有人均可读取前端配置）
app.get('/api/config', (req, res) => {
    try {
        const cfg = getConfig();
        // 只返回前端需要的公开字段，不含密码和解锁码列表暴露
        res.json({
            limitEnabled: cfg.limitEnabled !== undefined ? cfg.limitEnabled : false,
            freeQueries: cfg.freeQueries || 1,
            wechatId: cfg.wechatId || 'zzh250058',
            siteTitle: cfg.siteTitle || '伺服电缆选型工具',
            siteSubtitle: cfg.siteSubtitle || '',
            modalTitle: cfg.modalTitle || '',
            modalText: cfg.modalText || '',
            unlockSuccess: cfg.unlockSuccess || '',
            tipsText: cfg.tipsText || ''
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 保存配置（需要管理员密码验证）
app.post('/api/config', (req, res) => {
    const { password, ...configData } = req.body;
    if (!password) {
        return res.status(401).json({ error: '需要管理员密码' });
    }
    const cfg = getConfig();
    if (password !== cfg.adminPassword) {
        return res.status(403).json({ error: '密码错误' });
    }
    try {
        saveConfig(configData);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 验证管理员密码
app.post('/api/admin/verify', (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: '密码不能为空' });
    const cfg = getConfig();
    if (password === cfg.adminPassword) {
        res.json({ valid: true });
    } else {
        res.json({ valid: false });
    }
});

// 修改管理员密码
app.post('/api/admin/password', (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: '参数不完整' });
    }
    const cfg = getConfig();
    if (oldPassword !== cfg.adminPassword) {
        return res.status(403).json({ error: '当前密码错误' });
    }
    if (newPassword.length < 4) {
        return res.status(400).json({ error: '密码至少4位' });
    }
    try {
        saveConfig({ adminPassword: newPassword });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========== 查询限制 API ==========

// 获取查询状态（解锁码验证）
app.get('/api/query-status', (req, res) => {
    const ip = getClientIp(req);
    const used = ipQueries.get(ip) || 0;
    const unlockCode = req.query.code;
    const cfg = getConfig();

    if (unlockCode) {
        const codes = cfg.unlockCodes || ['KZY2024', 'SERVO888', 'CABLE666'];
        if (codes.includes(unlockCode.toUpperCase())) {
            ipQueries.set(ip, -1);
            return res.json({ unlimited: true, remaining: 999999, used: 0 });
        }
        return res.status(400).json({ error: 'invalid_code' });
    }

    const unlimited = used === -1;
    const freeLimit = cfg.freeQueries || 1;
    res.json({
        ip: ip.replace(/\d/g, '*'),
        used: unlimited ? 0 : used,
        remaining: unlimited ? 999999 : Math.max(0, freeLimit - used),
        unlimited: unlimited,
        freeLimit: freeLimit
    });
});

// 记录一次查询
app.post('/api/record-query', (req, res) => {
    const ip = getClientIp(req);
    const current = ipQueries.get(ip) || 0;
    if (current !== -1) {
        ipQueries.set(ip, current + 1);
    }
    const newCount = ipQueries.get(ip);
    const cfg = getConfig();
    const freeLimit = cfg.freeQueries || 1;
    res.json({
        used: newCount === -1 ? 0 : newCount,
        remaining: newCount === -1 ? 999999 : Math.max(0, freeLimit - newCount),
        unlimited: newCount === -1
    });
});

// ========== 数据查询 API ==========

// 获取所有品牌
app.get('/api/brands', (req, res) => {
    try {
        const brands = db.prepare("SELECT DISTINCT brand FROM cables ORDER BY brand").all();
        res.json(brands.map(b => b.brand));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 获取电机型号列表
app.get('/api/motors', (req, res) => {
    const { brand } = req.query;
    try {
        if (brand) {
            const motors = db.prepare("SELECT DISTINCT motor_model, full_model FROM cables WHERE brand = ? ORDER BY motor_model").all(brand);
            res.json(motors);
        } else {
            const motors = db.prepare("SELECT DISTINCT brand, motor_model, full_model FROM cables ORDER BY brand, motor_model").all();
            res.json(motors);
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 获取电缆类型
app.get('/api/cable-types', (req, res) => {
    const { motor_model, brand } = req.query;
    if (!motor_model) {
        return res.status(400).json({ error: 'motor_model is required' });
    }
    try {
        const types = db.prepare(
            "SELECT DISTINCT cable_type FROM cables WHERE motor_model = ? AND brand = ? ORDER BY cable_type"
        ).all(motor_model, brand || '安川');
        res.json(types.map(t => t.cable_type));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 获取所有电缆数据（用于初始加载）
app.get('/api/all-cables', (req, res) => {
    try {
        const cables = db.prepare("SELECT * FROM cables ORDER BY brand, motor_model, cable_type").all();
        res.json(cables);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 搜索电缆
app.get('/api/cables', (req, res) => {
    const { motor_model, brand, cable_type, connector_spec, length_m } = req.query;

    // 防批量下载：必须传入至少2个字符的型号
    if (!motor_model || motor_model.trim().length < 2) {
        return res.json([]);
    }

    const brand_ = brand || '安川';

    const conds = ['brand = ?'];
    const params = [brand_];
    if (motor_model) {
        conds.push('(motor_model LIKE ? OR full_model LIKE ?)');
        params.push('%' + motor_model + '%', '%' + motor_model + '%');
    }
    if (cable_type) { conds.push('cable_type = ?'); params.push(cable_type); }
    if (connector_spec) { conds.push('connector_spec LIKE ?'); params.push('%' + connector_spec + '%'); }
    if (length_m) { conds.push('length_m = ?'); params.push(length_m); }

    const sql = 'SELECT * FROM cables WHERE ' + conds.join(' AND ') + ' ORDER BY cable_type, connector_spec, length_m';

    try {
        const cables = db.prepare(sql).all(...params);
        res.json(cables);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 获取接头规格列表
app.get('/api/connectors', (req, res) => {
    const { motor_model, brand, cable_type } = req.query;
    if (!motor_model) {
        return res.status(400).json({ error: 'motor_model is required' });
    }
    try {
        let sql = "SELECT DISTINCT connector_spec FROM cables WHERE motor_model = ? AND brand = ?";
        const params = [motor_model, brand || '安川'];
        if (cable_type) {
            sql += " AND cable_type = ?";
            params.push(cable_type);
        }
        sql += " ORDER BY connector_spec";
        const connectors = db.prepare(sql).all(...params);
        res.json(connectors.map(c => c.connector_spec));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 获取可选长度列表
app.get('/api/lengths', (req, res) => {
    const { motor_model, brand, cable_type, connector_spec } = req.query;
    if (!motor_model) {
        return res.status(400).json({ error: 'motor_model is required' });
    }
    try {
        let sql = "SELECT DISTINCT length_m FROM cables WHERE motor_model = ? AND brand = ?";
        const params = [motor_model, brand || '安川'];
        if (cable_type) {
            sql += " AND cable_type = ?";
            params.push(cable_type);
        }
        if (connector_spec) {
            sql += " AND connector_spec = ?";
            params.push(connector_spec);
        }
        sql += " ORDER BY length_m";
        const lengths = db.prepare(sql).all(...params);
        res.json(lengths.map(l => l.length_m));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========== IN-MEMORY 状态 ==========
const ipQueries = new Map();

app.listen(PORT, '0.0.0.0', () => {
    console.log('Servo Cable API running on http://0.0.0.0:' + PORT);
});
