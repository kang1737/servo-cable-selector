const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001;

// DB
const DB_PATH = path.join(__dirname, 'servo-cable.db');
const db = new Database(DB_PATH, { readonly: true });

// IP query tracking (in-memory)
const ipQueries = new Map();
const FREE_QUERIES = 1;
const UNLOCK_CODES = new Set(['KZY2024', 'SERVO888', 'CABLE666']);

function getClientIp(req) {
    var fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',')[0].trim();
    var real = req.headers['x-real-ip'];
    if (real) return real;
    if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
    return 'unknown';
}

app.use(cors());

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// Check query limit for this IP
app.get('/api/query-status', (req, res) => {
    const ip = getClientIp(req);
    const used = ipQueries.get(ip) || 0;
    const unlockCode = req.query.code;

    if (unlockCode) {
        if (UNLOCK_CODES.has(unlockCode.toUpperCase())) {
            ipQueries.set(ip, -1);
            return res.json({ unlimited: true, remaining: 999999, used: 0 });
        }
        return res.status(400).json({ error: 'invalid_code' });
    }

    const unlimited = used === -1;
    res.json({
        ip: ip.replace(/\d/g, '*'),
        used: unlimited ? 0 : used,
        remaining: unlimited ? 999999 : Math.max(0, FREE_QUERIES - used),
        unlimited: unlimited,
        freeLimit: FREE_QUERIES
    });
});

// Record a query
app.post('/api/record-query', (req, res) => {
    const ip = getClientIp(req);
    const current = ipQueries.get(ip) || 0;
    if (current !== -1) {
        ipQueries.set(ip, current + 1);
    }
    const newCount = ipQueries.get(ip);
    res.json({
        used: newCount === -1 ? 0 : newCount,
        remaining: newCount === -1 ? 999999 : Math.max(0, FREE_QUERIES - newCount),
        unlimited: newCount === -1
    });
});

// Get all brands
app.get('/api/brands', (req, res) => {
    const brands = db.prepare("SELECT DISTINCT brand FROM cables ORDER BY brand").all();
    res.json(brands.map(b => b.brand));
});

// Get motor models by brand
app.get('/api/motors', (req, res) => {
    const { brand } = req.query;
    if (brand) {
        const motors = db.prepare("SELECT DISTINCT motor_model, full_model FROM cables WHERE brand = ? ORDER BY motor_model").all(brand);
        res.json(motors);
    } else {
        const motors = db.prepare("SELECT DISTINCT brand, motor_model, full_model FROM cables ORDER BY brand, motor_model").all();
        res.json(motors);
    }
});

// Get cable types by motor model
app.get('/api/cable-types', (req, res) => {
    const { motor_model, brand } = req.query;
    if (!motor_model) {
        return res.status(400).json({ error: 'motor_model is required' });
    }
    const types = db.prepare(
        "SELECT DISTINCT cable_type FROM cables WHERE motor_model = ? AND brand = ? ORDER BY cable_type"
    ).all(motor_model, brand || '安川');
    res.json(types.map(t => t.cable_type));
});

// Load all cables for initial page load (bypasses motor_model requirement)
app.get('/api/all-cables', (req, res) => {
    try {
        const cables = db.prepare("SELECT * FROM cables ORDER BY brand, motor_model, cable_type").all();
        res.json(cables);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Search cables - main query endpoint
app.get('/api/cables', (req, res) => {
    const { motor_model, brand, cable_type, connector_spec, length_m } = req.query;

    // 防批量下载：必须传入至少2个字符的型号，否则返回空
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

// Get distinct connector specs for a motor model
app.get('/api/connectors', (req, res) => {
    const { motor_model, brand, cable_type } = req.query;
    if (!motor_model) {
        return res.status(400).json({ error: 'motor_model is required' });
    }
    let sql = "SELECT DISTINCT connector_spec FROM cables WHERE motor_model = ? AND brand = ?";
    const params = [motor_model, brand || '安川'];
    if (cable_type) {
        sql += " AND cable_type = ?";
        params.push(cable_type);
    }
    sql += " ORDER BY connector_spec";
    const connectors = db.prepare(sql).all(...params);
    res.json(connectors.map(c => c.connector_spec));
});

// Get distinct lengths for a motor model
app.get('/api/lengths', (req, res) => {
    const { motor_model, brand, cable_type, connector_spec } = req.query;
    if (!motor_model) {
        return res.status(400).json({ error: 'motor_model is required' });
    }
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
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('Servo Cable API running on http://0.0.0.0:' + PORT);
});
