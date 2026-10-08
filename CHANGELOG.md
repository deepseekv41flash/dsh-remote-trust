# Changelog

## 0.1.0 — 2026-10-08

首个发布版本。

- 用 `ctx.webServer.tapIndex()` 向 index.html 注入
  `__DSH_TRANSPORT__.ownsHost = true`，让反向代理下的非 loopback 页面被客户端视为
  可信本机，设置镜像随之切到 `host` 持久化 —— 修掉
  `settings are unavailable in this browser`。
- 注入幂等（已声明则原样返回）、`</head>` 缺失时原样返回、`tapIndex` 缺失时静默降级；
  disposer 挂在 `ctx.effect` 上，卸载即净。
- 15 项 `node:test` 用例；`bash scripts/build.sh` 先校验导出再跑全套。

### 实测环境（生产验证，非仅单测）

- dsh `0.2.0-rc.2`：容器内 `dsh web --trusted-host <域名>`（`--network host`），
  宿主 nginx 按域名反向代理到 `127.0.0.1:3080`。
- 修复前：访问日志里**从未出现** `POST /api/settings/describe`，模型页报那句兜底文案。
- 修复后：Console `globalThis.__DSH_TRANSPORT__` = `{ ownsHost: true }`，
  `POST /api/settings/describe → 200 7844`，模型页正常；
  `GET /api/remote.mux → 101`（WebSocket 复用通道健康）。

### 制品指纹

`lib/index.js` — 2632 字节
sha256 `1e0b010371ffd9ac7f4bc2ac5b890296796a0012048468a54bb91dd86653b45f`

与上述生产环境**正在运行的那份字节完全相同**：发布件即实战验证件。
