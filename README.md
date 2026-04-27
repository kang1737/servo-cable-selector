# 伺服电缆选型工具

基于实际电缆数据库，智能匹配安川伺服电机电缆型号。

## 功能特点

- 支持完整型号（如 SGMXG-09AUA61C2）和短代码（如 SGMXG-09/13）搜索
- 左右分栏展示电机电缆和编码器电缆，无需频繁上下滚动
- 电机电缆根据型号自动匹配（61C2=无抱闸，6CC2=带抱闸）
- 编码器电缆显示该电机所有可选类型（无电池/带电池），供用户自选

## 技术栈

- 前端：纯 HTML/CSS/JS（无框架依赖）
- 后端：Node.js + Express + SQLite
- 部署：Docker + Nginx

## 目录结构

```
servo-cable-selector/
├── index.html        # 前端主页面
├── admin.html        # 后台登录页
├── admin-panel.html  # 后台管理面板
├── server.js         # 后端 API 服务
├── package.json      # Node.js 依赖
├── Dockerfile        # Docker 构建文件
└── servo-cable.db    # SQLite 数据库
```

## 部署

```bash
# 克隆仓库
git clone https://github.com/kang1737/servo-cable-selector.git

# 启动后端
cd servo-cable-selector
npm install
node server.js

# 配置 Nginx 代理
# 将 /servo-cable/ 指向后端服务
```

## 访问地址

- 网站：http://106.52.100.77/servo-cable/
- 后台：http://106.52.100.77/servo-cable/admin.html

## License

MIT
