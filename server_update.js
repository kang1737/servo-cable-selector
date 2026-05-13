// 此脚本在服务器上运行一次：添加 config 表并写入默认配置
// 运行方式: node server_update.js
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'servo-cable.db');
const db = new Database(DB_PATH);

// 创建 config 表
db.exec(`
CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
);
`);

// 默认配置
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

// 插入或更新默认配置
const stmt = db.prepare('INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)');
stmt.run(JSON.stringify(defaultConfig));

console.log('✅ Config table initialized with default config');
db.close();
