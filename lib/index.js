/**
 * dsh-remote-trust — 让经域名（非 loopback）访问的页面被客户端视为"可信本机"。
 *
 * 背景：dsh-client-connection/lib/client.js 计算
 *   isLoopback = transport?.ownsHost === true
 *             || pageLocation === void 0
 *             || isLoopbackHostname(pageLocation.hostname)
 * 而 dsh-client-ui-settings/lib/client.js 用它决定设置镜像的持久化模式：
 *   persistence = ctx.remote.$host.isLoopback ? "host" : "memory"
 * 非 loopback 页面拿到 "memory"，镜像的 ensure()/load() 直接空转、永不发起
 * settings.describe，于是模型/提供方目录页报
 * "settings are unavailable in this browser"（文案误导，实为设计门控）。
 *
 * 本插件用官方 index 变换 API（ctx.webServer.tapIndex）向 index.html 注入一行，
 * 声明 __DSH_TRANSPORT__.ownsHost = true —— 这是 dsh-client-connection 为
 * "自己拼 transport 的壳"预留的官方逃生通道，客户端据此把本页当作可信本机，
 * 设置镜像因此切到 "host" 持久化并真正读取。
 *
 * 安全边界：
 *   - 只影响浏览器对该页面的判定；服务端信任护栏不变，仍是
 *     loopback ∪ --trusted-host（本部署已声明 dsh.hyw114514.asia）。
 *   - 但该声明同时会放开其他以 isLoopback 为条件的"本机专属"表面，因此这个
 *     页面必须继续由 token（以及后续的访问密码）保护，不能裸奔。
 *   - 卸载即净：tapIndex 返回的 disposer 交给 ctx.effect，插件停用/卸载时还原。
 */
export const name = "dsh-remote-trust";

/** 需要 webServer 就绪（index 变换 API 由它提供）。 */
export const inject = ["webServer"];

/** 注入的声明脚本：幂等（Object.assign 覆盖同一键）。 */
const REMOTE_TRUST_SCRIPT =
  '<script>globalThis.__DSH_TRANSPORT__=Object.assign({},globalThis.__DSH_TRANSPORT__,{ownsHost:true});</script>';

/**
 * 注册 index.html 变换。
 * @param ctx - 插件上下文（inject 保证 webServer 可用）。
 */
export function apply(ctx) {
  if (typeof ctx.webServer?.tapIndex !== "function") {
    ctx.logger?.warn?.("[dsh-remote-trust] webServer.tapIndex 不可用，未注入任何内容");
    return;
  }
  const off = ctx.webServer.tapIndex((html) => {
    // 幂等守卫：已声明过就不再重复注入。
    if (html.includes("ownsHost")) return html;
    return html.replace("</head>", REMOTE_TRUST_SCRIPT + "</head>");
  });
  ctx.effect(() => off, "dsh-remote-trust: index tap");
  ctx.logger?.info?.(
    "[dsh-remote-trust] index tap registered (__DSH_TRANSPORT__.ownsHost = true)"
  );
}
