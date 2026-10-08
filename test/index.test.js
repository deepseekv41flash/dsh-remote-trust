import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, inject, name } from "../lib/index.js";

/** The exact declaration the plugin injects (byte-level contract). */
const SCRIPT =
  '<script>globalThis.__DSH_TRANSPORT__=Object.assign({},globalThis.__DSH_TRANSPORT__,{ownsHost:true});</script>';

/** A stand-in for a served dsh index.html (head, then body, app bundle in head). */
const INDEX = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>DeepSeek Harness</title>
    <script type="module" src="/assets/index-abc123.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

/**
 * Records every registered tap and effect so tests can drive them by hand,
 * mirroring how @deepseek-ai/dsh-host-webserver applies index transforms.
 */
function harness({ tapIndex = true } = {}) {
  const taps = [];
  const effects = [];
  const info = [];
  const warn = [];
  const ctx = {
    logger: {
      info: (message) => info.push(message),
      warn: (message) => warn.push(message)
    },
    effect(callback, label) {
      effects.push({ callback, label });
      return callback;
    }
  };
  if (tapIndex) {
    ctx.webServer = {
      tapIndex(transform) {
        taps.push(transform);
        return () => {
          const at = taps.indexOf(transform);
          if (at !== -1) taps.splice(at, 1);
        };
      }
    };
  }
  /**
   * Model the framework's cleanup order: run each effect callback, then invoke
   * the disposer it returned, newest first.
   */
  const disposers = () =>
    effects
      .map(({ callback }) => callback())
      .filter((value) => typeof value === "function")
      .reverse();
  return { ctx, taps, effects, info, warn, disposers };
}

/** Apply every registered tap in registration order. */
const render = (taps, html) => taps.reduce((out, tap) => tap(out), html);

test("exports the plugin shape the loader requires", () => {
  assert.equal(name, "dsh-remote-trust");
  assert.deepEqual(inject, ["webServer"]);
  assert.equal(typeof apply, "function");
});

test("registers exactly one index tap and one disposer", () => {
  const { ctx, taps, effects, info } = harness();
  apply(ctx);
  assert.equal(taps.length, 1);
  assert.equal(effects.length, 1);
  assert.equal(info.length, 1);
  assert.match(effects[0].label, /dsh-remote-trust/);
});

test("no tap is registered when tapIndex is unavailable (fails soft)", () => {
  const { ctx, taps, effects, warn } = harness({ tapIndex: false });
  assert.doesNotThrow(() => apply(ctx));
  assert.equal(taps.length, 0);
  assert.equal(effects.length, 0);
  assert.equal(warn.length, 1);
  assert.match(warn[0], /tapIndex/);
});

test("the tap declares ownsHost through the official transport escape hatch", () => {
  const { ctx, taps } = harness();
  apply(ctx);
  const out = render(taps, INDEX);
  assert.ok(out.includes("__DSH_TRANSPORT__"));
  assert.ok(out.includes("ownsHost:true"));
});

test("the declaration is injected inside <head>, immediately before </head>", () => {
  const { ctx, taps } = harness();
  apply(ctx);
  const out = render(taps, INDEX);
  const injected = out.indexOf(SCRIPT);
  assert.ok(injected > 0, "the declaration must be present");
  assert.equal(injected + SCRIPT.length, out.indexOf("</head>"));
  assert.ok(injected < out.indexOf("<body>"));
});

test("the injection is strictly additive: removing it restores the original bytes", () => {
  const { ctx, taps } = harness();
  apply(ctx);
  const out = render(taps, INDEX);
  assert.equal(out.replace(SCRIPT, ""), INDEX);
});

test("the injected script is a single line with no newline", () => {
  assert.ok(!SCRIPT.includes("\n"));
  const { ctx, taps } = harness();
  apply(ctx);
  const out = render(taps, INDEX);
  assert.equal(out.split("\n").length, INDEX.split("\n").length);
});

test("re-applying the tap is idempotent", () => {
  const { ctx, taps } = harness();
  apply(ctx);
  const once = render(taps, INDEX);
  assert.equal(taps[0](once), once);
});

test("an index that already declares ownsHost is returned byte-identical", () => {
  const { ctx, taps } = harness();
  apply(ctx);
  const already = INDEX.replace("</head>", SCRIPT + "</head>");
  assert.equal(render(taps, already), already);
});

test("an index without </head> is returned unchanged (documented behaviour)", () => {
  const { ctx, taps } = harness();
  apply(ctx);
  const headless = '<!DOCTYPE html><html><body><div id="root"></div></body></html>';
  assert.equal(render(taps, headless), headless);
});

test("the transform is pure: the same input always yields the same output", () => {
  const { ctx, taps } = harness();
  apply(ctx);
  assert.equal(taps[0](INDEX), taps[0](INDEX));
});

test("a replacer-hostile index is still injected verbatim", () => {
  // `$&`, `$'` and friends are special in String.replace replacement strings;
  // the declaration contains none of them, so it must survive byte-for-byte.
  const { ctx, taps } = harness();
  apply(ctx);
  const tricky = INDEX.replace("<body>", "<body>$& $' $1 $$ <body>");
  const out = render(taps, tricky);
  assert.ok(out.includes(SCRIPT));
  assert.equal(out.replace(SCRIPT, ""), tricky);
});

test("the disposer returned by the tap removes the transform", () => {
  const { ctx, taps, effects } = harness();
  apply(ctx);
  assert.equal(taps.length, 1);
  const [disposer] = effects.map(({ callback }) => callback());
  assert.equal(typeof disposer, "function");
  assert.equal(taps.length, 1, "returning the disposer must not dispose anything");
  disposer();
  assert.equal(taps.length, 0);
});

test("the disposer is idempotent", () => {
  const { ctx, taps, disposers } = harness();
  apply(ctx);
  const [disposer] = disposers();
  disposer();
  assert.doesNotThrow(() => disposer());
  assert.equal(taps.length, 0);
});

test("the log line names the mechanism it enabled", () => {
  const { ctx, info } = harness();
  apply(ctx);
  assert.match(info[0], /ownsHost/);
});
