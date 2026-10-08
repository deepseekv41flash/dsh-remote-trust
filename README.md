# dsh-remote-trust

[中文](README.md) · [English](README-en.md)

让**经域名反向代理访问**（非 loopback）的 dsh 页面被客户端当作"可信本机"，
从而让**设置界面**真正可用 —— 修掉上游「非 loopback 页面保留 Client 策略」这道设计门控。

## 症状

页面能打开、聊天也正常，但一进 **设置 → 模型** 就报：

```
加载提供商目录失败: settings are unavailable in this browser
```

而本机 `http://127.0.0.1:3080` 访问时一切正常。

## 根因（设计门控，不是故障）

`@deepseek-ai/dsh-client-connection` 判定页面是否可信：

```js
isLoopback = transport?.ownsHost === true
          || pageLocation === void 0
          || isLoopbackHostname(pageLocation.hostname)   // localhost / [::1] / 127.0.0.0/8
```

`@deepseek-ai/dsh-client-ui-settings` 用这个判定选择设置镜像的持久化模式：

```js
const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";
```

非 loopback 页面拿到 `"memory"`，镜像的 `ensure()` / `load()` 直接空转、
**永不发起 `settings.describe`**；`dsh-client-ui-settings-models` 于是拿到
`view === undefined`，只能给出那句误导性的兜底文案。

注意：服务端**并没有拦**。`--trusted-host` 声明的域名本来就能过 `/api/*` 的信任护栏
（本版本没有特权方法的 loopback 硬钉），缺的只是浏览器侧这一步判定。

## 原理

用官方 index 变换 API（`ctx.webServer.tapIndex`）向 index.html 注入一行：

```html
<script>globalThis.__DSH_TRANSPORT__=Object.assign({},globalThis.__DSH_TRANSPORT__,{ownsHost:true});</script>
```

`ownsHost` 是 `dsh-client-connection` 为"自己拼 transport 的壳"预留的**官方逃生通道**：
声明后 `isLoopback` 为 true，设置镜像切到 `host` 持久化并真正读取。

- 不改 DSH 源码、不覆盖 `server.emit`、不引入任何依赖；
- 注入幂等（已声明则原样返回），`</head>` 缺失时原样返回、不报错；
- 卸载即净：tap 的 disposer 挂在 `ctx.effect` 上，插件停用/卸载时撤下。

## 安装

```bash
dsh plugin --profile web add dsh-remote-trust
```

重启 dsh 后生效（profile 若没有 `patchReload: live`，改配置一律需要重启）。

## 验证

浏览器 DevTools Console：

```js
globalThis.__DSH_TRANSPORT__     // 期望 { ownsHost: true }
```

然后进 **设置 → 模型**，提供商目录应正常加载（Network 里能看到
`POST /api/settings/describe → 200`）。

## ⚠️ 安全边界（务必阅读）

这个插件是**有意放宽一道设计门控**的，请只在你清楚后果时启用：

- 声明 `ownsHost` 会把**该页面**视为"可信本机"，因而**同时**放开其他以 `isLoopback`
  为条件的本机专属客户端表面（例如"打开配置文件"、原生目录选择等）。
- 因此该页面**必须**继续由 dsh 自己的 token / 浏览器会话 cookie 保护；公网部署建议
  再加一道认证（nginx Basic Auth、IP 白名单、或接入层认证）。
- 它**不改变**服务端信任护栏：`/api/*` 仍是「loopback ∪ `--trusted-host`」，
  所以仍然必须用 `--trusted-host <你的域名>` 启动 dsh web。
- 只对"你自己可达、且已经用别的手段保护住"的部署启用。

## 兼容性

- 已在 **dsh `0.2.0-rc.2`**（容器内 `dsh web` + 宿主 nginx 按域名反向代理）实测通过。
- 依赖两个官方内部：`ctx.webServer.tapIndex()`（缺失时**静默降级**：记一条 warn、
  不注入任何内容，不会影响宿主）与 `__DSH_TRANSPORT__.ownsHost` 逃生通道。
- 上游若改动后者，本插件会失效 —— 症状就是那句话复发。

## 卸载

```bash
dsh plugin --profile web remove dsh-remote-trust
```

重启后 index.html 恢复原样。

## 许可

MIT
