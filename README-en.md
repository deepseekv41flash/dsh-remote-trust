# dsh-remote-trust

[中文](README.md) · [English](README-en.md)

Makes a **reverse-proxied (non-loopback)** dsh page count as a trusted host, so the
**Settings surface** actually works — undoing the upstream "non-loopback pages keep the
client policy" design gate.

## Symptom

The page loads and chat works, but **Settings → Models** reports:

```
Failed to load the provider directory: settings are unavailable in this browser
```

Accessing `http://127.0.0.1:3080` on the host itself is fine.

## Root cause (an intentional gate, not a bug)

`@deepseek-ai/dsh-client-connection` decides whether the page is trusted:

```js
isLoopback = transport?.ownsHost === true
          || pageLocation === void 0
          || isLoopbackHostname(pageLocation.hostname)   // localhost / [::1] / 127.0.0.0/8
```

`@deepseek-ai/dsh-client-ui-settings` uses that decision to pick the settings mirror's
persistence mode:

```js
const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";
```

A non-loopback page gets `"memory"`, where the mirror's `ensure()` / `load()` return
immediately and **never issue `settings.describe`**; `dsh-client-ui-settings-models` then
sees `view === undefined` and can only render that misleading fallback.

The server does **not** block anything here: a domain declared through `--trusted-host`
already passes the `/api/*` trust fence (this version has no loopback pin on privileged
methods) — only the browser-side decision is missing.

## How it works

It uses the official index-transform API (`ctx.webServer.tapIndex`) to inject one line
into index.html:

```html
<script>globalThis.__DSH_TRANSPORT__=Object.assign({},globalThis.__DSH_TRANSPORT__,{ownsHost:true});</script>
```

`ownsHost` is the official escape hatch `dsh-client-connection` reserves for
"shells that assemble their own transport": with it declared, `isLoopback` becomes true,
the settings mirror switches to `host` persistence and really reads.

- No DSH source is modified, no `server.emit` override, no dependencies.
- The injection is idempotent (returns the input unchanged when already declared) and
  returns the input unchanged when `</head>` is missing.
- Uninstall is clean: the tap disposer is registered on `ctx.effect`.

## Install

```bash
dsh plugin --profile web add dsh-remote-trust
```

Restart dsh (a profile without `patchReload: live` always needs a restart).

## Verify

Browser DevTools console:

```js
globalThis.__DSH_TRANSPORT__     // expect { ownsHost: true }
```

Then open **Settings → Models**: the provider directory should load, and the Network
panel should show `POST /api/settings/describe → 200`.

## ⚠️ Security boundary (please read)

This plugin **deliberately relaxes a design gate**, so enable it only where you
understand the consequences:

- Declaring `ownsHost` makes **that page** count as a trusted local host, which also
  unlocks other loopback-only client surfaces (e.g. "open the config file", native
  directory pickers).
- The page therefore **must** stay protected by dsh's own token / browser session
  cookie; for public deployments add a second factor (nginx Basic Auth, an IP allowlist,
  or an authenticating gateway).
- It does **not** change the server-side trust fence: `/api/*` is still
  "loopback ∪ `--trusted-host`", so you still must start dsh web with
  `--trusted-host <your domain>`.
- Only enable it for deployments you can reach yourself and have protected by other means.

## Compatibility

- Verified on **dsh `0.2.0-rc.2`** (containerised `dsh web` behind a host nginx
  reverse proxy on a domain).
- Depends on two upstream internals: `ctx.webServer.tapIndex()` (missing → **fails soft**:
  one warning, nothing injected, host unaffected) and the `__DSH_TRANSPORT__.ownsHost`
  escape hatch.
- If upstream changes the latter, this plugin stops working — the symptom is that
  settings message coming back.

## Uninstall

```bash
dsh plugin --profile web remove dsh-remote-trust
```

After a restart, index.html is served exactly as before.

## License

MIT
