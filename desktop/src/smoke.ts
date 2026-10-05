import { app, session, type BrowserWindow, type NativeImage, type Tray } from "electron";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import type { TrackerEngine } from "./engine";
import type { ApiReply } from "./contract";
import { DIAGNOSTIC_FILE } from "./diagnostics";
import { desktopIdentity } from "./identity";
import type { PowerStats } from "./power-check";
import { idleSource } from "../../lib/tracking";

export async function runSmoke({ main, mini, engine, icons, request, tray, stats }: { main: BrowserWindow; mini: BrowserWindow; engine: TrackerEngine; icons: Record<string, NativeImage>; request: (path: string) => Promise<ApiReply>; tray: Tray; stats: PowerStats }) {
  const ready = async (w: BrowserWindow) => {
    if (w.webContents.isLoading()) await new Promise<void>(resolve => w.webContents.once("did-finish-load", () => resolve()));
    for (let i = 0; i < 50; i++) {
      if (await w.webContents.executeJavaScript("!!document.querySelector('#root')?.textContent?.length")) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Renderer did not mount.");
  };
  await Promise.all([ready(main), ready(mini)]);
  assert.equal(app.getName(), desktopIdentity(app.isPackaged, true).name, "smoke tests have their own Windows identity");
  assert.ok(Object.values(icons).every(i => !i.isEmpty()), "all native icons loaded");
  assert.ok(!tray.isDestroyed());
  const state = await main.webContents.executeJavaScript("({text:document.body.innerText, bridge:typeof window.desktop, node:typeof window.require})");
  assert.equal(state.node, "undefined"); assert.equal(state.bridge, "object");
  assert.match(state.text, /YanTasks/);
  // Test the actual setting control and its saved guest state, not only IPC.
  const minimumControl = "document.querySelector('input[aria-describedby=\"minimum-hint\"]')";
  const waitFor = async (expression: string) => {
    for (let i = 0; i < 50; i++) {
      if (await main.webContents.executeJavaScript(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Renderer condition not met: ${expression}`);
  };
  await waitFor(`!!${minimumControl}`);
  assert.equal(await main.webContents.executeJavaScript("document.querySelector('.day-settings').open"), false, "settings start collapsed so the timer stays prominent");
  await main.webContents.executeJavaScript("document.querySelector('.day-settings > summary').click()");
  await waitFor("document.querySelector('.day-settings').open");
  assert.equal(await main.webContents.executeJavaScript(`${minimumControl}.checked`), true);
  const minutesControl = "document.querySelector('input[aria-label=\"Minimum daily target in minutes\"]')";
  await main.webContents.executeJavaScript(`{
    const input = ${minutesControl}; input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '15');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }`);
  // The smoke window is hidden, so DOM focus/blur are not guaranteed to fire.
  // Let React commit the input draft, then deliver its normal bubbling blur event.
  await new Promise(resolve => setTimeout(resolve, 50));
  await main.webContents.executeJavaScript(`${minutesControl}.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))`);
  await waitFor("localStorage.getItem('yantasks.minimumMinutes.v1') === '15'");
  await waitFor("window.desktop.snapshot().then(v => v.state.minimumMinutes === 15)");
  await main.webContents.executeJavaScript(`${minimumControl}.click()`);
  await waitFor("localStorage.getItem('yantasks.minimumEnabled.v1') === 'false'");
  await waitFor("window.desktop.snapshot().then(v => v.state.minimumEnabled === false)");
  main.webContents.reload();
  await ready(main);
  await waitFor(`!!${minimumControl} && !${minimumControl}.checked`);
  await main.webContents.executeJavaScript("document.querySelector('.day-settings > summary').click()");
  await waitFor(`${minutesControl}?.value === '15'`);
  await waitFor("window.desktop.snapshot().then(v => v.state.minimumEnabled === false)");
  await main.webContents.executeJavaScript(`${minimumControl}.click()`);
  await waitFor("window.desktop.snapshot().then(v => v.state.minimumEnabled === true)");
  await waitFor("window.desktop.snapshot().then(v => v.state.minimumMinutes === 15)");
  await assert.rejects(main.webContents.executeJavaScript("window.desktop.api({path:'https://example.com', method:'GET'})"));
  assert.equal((await request("/api/state")).status, 503);
  // Check Electron's real session transport preserves httpOnly cookies. This
  // localhost fixture is isolated from both production and the user's account.
  const server = createServer((req, res) => {
    if (req.url === "/set") res.setHeader("Set-Cookie", "fixture=ok; HttpOnly; SameSite=Lax; Path=/");
    res.end(req.headers.cookie ?? "");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const transport = session.fromPartition("smoke-cookie-fixture");
    await transport.fetch(base + "/set", { credentials: "include" });
    assert.match(await (await transport.fetch(base + "/read", { credentials: "include" })).text(), /fixture=ok/);
    assert.equal((await transport.cookies.get({ url: base }))[0].httpOnly, true);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  // Exercise the real sandbox/IPC/engine, using only this disposable guest profile.
  await main.webContents.executeJavaScript(`window.desktop.configure({accountId:null,endTime:'23:59',tasks:[{id:'smoke',title:'Windows smoke test',description:'',dueDate:'2099-01-01',completed:false,createdAt:new Date().toISOString(),completedAt:null}]})`);
  await main.webContents.executeJavaScript("window.desktop.command({type:'start'})");
  assert.equal(engine.view().state.mode, "work");
  main.hide(); mini.hide();
  await new Promise(resolve => setTimeout(resolve, 1200)); engine.tick();
  assert.ok(engine.view().state.workMs > 1000, "tracking advances with both windows hidden");
  await mini.webContents.executeJavaScript("window.desktop.command({type:'pause'})");
  assert.equal(engine.view().state.mode, "idle");
  await main.webContents.executeJavaScript("window.desktop.command({type:'reset'})");
  assert.equal(engine.view().state.workMs, 0);
  if (process.argv.includes("--countdown-check")) {
    // Real visible renderers and the production wake scheduler, not manual
    // engine.tick calls. Transparent/click-through windows do not interrupt
    // the user's desktop. All data belongs to the isolated guest profile.
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const readSeconds = async (w: BrowserWindow, selector: string) => {
      const text = await w.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.textContent`);
      assert.match(text, /^\d+:\d{2}:\d{2}$/);
      return text.split(":").reduce((seconds: number, part: string) => seconds * 60 + Number(part), 0);
    };
    for (const [w, selector] of [[main, ".focus-clock"], [mini, ".mini-clock"]] as const) {
      main.hide(); mini.hide();
      w.setOpacity(0); w.setIgnoreMouseEvents(true); w.showInactive();
      await sleep(250);
      const before = await readSeconds(w, selector);
      await sleep(3200);
      const after = await readSeconds(w, selector);
      assert.ok(before - after >= 2 && before - after <= 4, `${selector} counts down in real time: ${before} -> ${after}`);
      assert.equal(engine.view().state.mode, "idle");
      assert.equal(engine.view().state.workMs, 0);
    }
    // Also exercise the clock after today's idle allowance is gone. A short
    // future cutoff and a 20:1 split make this an overdue, still-idle day. This
    // changes only the disposable smoke profile, never the installed app.
    const local = new Date();
    const endMinutes = Math.min(1439, local.getHours() * 60 + local.getMinutes() + 3);
    const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
    await main.webContents.executeJavaScript(`window.desktop.configure(${JSON.stringify({ accountId: null, tasks: engine.view().state.tasks, endTime, plan: { startTime: "00:00", workParts: 20, idleParts: 1 } })})`);
    assert.ok(idleSource(engine.view().state), "smoke fixture is drawing on future idle time");
    for (const [w, selector] of [[main, ".focus-clock"], [mini, ".mini-clock"]] as const) {
      main.hide(); mini.hide();
      w.setOpacity(0); w.setIgnoreMouseEvents(true); w.showInactive();
      await sleep(250);
      const sourceBefore = idleSource(engine.view().state);
      const before = await readSeconds(w, selector);
      await sleep(3200);
      const after = await readSeconds(w, selector);
      const sourceAfter = idleSource(engine.view().state);
      assert.ok(sourceBefore && sourceAfter);
      // Crossing into the next future day legitimately resets that day's clock.
      if (sourceBefore.dayKey === sourceAfter.dayKey) assert.ok(before - after >= 2 && before - after <= 4, `${selector} borrowed clock counts down: ${before} -> ${after}`);
      assert.equal(engine.view().state.mode, "idle"); assert.equal(engine.view().state.workMs, 0);
      assert.match(await w.webContents.executeJavaScript("document.body.innerText"), /Borrowed|BORROWED/);
    }
    main.hide(); mini.hide();
    await sleep(100);
    const before = { ...stats };
    await sleep(2200);
    assert.equal(stats.publishes, before.publishes, "hidden idle returns to the low-power wake schedule");
    assert.equal(stats.sends, before.sends, "hidden renderers receive no countdown IPC");
    console.log("COUNTDOWN CHECK PASS: main and mini clocks advance for today's and borrowed idle; hidden windows stay quiet.");
  }
  await assert.rejects(mini.webContents.executeJavaScript("window.desktop.api({path:'/api/auth/me',method:'GET'})"));
  // Opt-in native delivery probe. The normal smoke run remains silent. Only
  // this disposable profile is touched; no real account timer is changed.
  if (process.argv.includes("--alert-check")) {
    await main.webContents.executeJavaScript("window.desktop.window('test-alert')");
    const logFile = path.join(app.getPath("userData"), DIAGNOSTIC_FILE);
    let shown = false;
    for (let i = 0; i < 50; i++) {
      const records = fs.readFileSync(logFile, "utf8").trim().split("\n").map(line => JSON.parse(line));
      assert.ok(!records.some(r => r.kind === "native-failed"), "Windows accepted the native test alert");
      shown = records.some(r => r.kind === "native-shown" && r.eventType === "test");
      if (shown) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(shown, "Windows reported the test notification shown");
    console.log(`ALERT CHECK PASS: native request and show callback recorded in ${logFile}`);
  }
  if (process.argv.includes("--countdown-check")) {
    // The cadence probe deliberately hides a previously visible Chromium
    // surface; capturing it can wait for a frame that will never be painted.
    console.log("SMOKE PASS: isolated guest, sandbox, IPC, real visible countdowns and hidden-window power policy.");
    return;
  }
  const image = await mini.webContents.capturePage();
  const imagePath = path.join(app.getPath("userData"), "mini.png");
  fs.writeFileSync(imagePath, image.toPNG());
  console.log(`SMOKE PASS: isolated guest, sandbox, IPC allowlist, shared tracker, hidden-window tracking, mini controls, icons, tray. Screenshot: ${imagePath}`);
}
