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
  // Hidden windows intentionally receive no snapshots. Make this isolated
  // window visible but transparent/click-through while exercising its UI.
  main.setOpacity(0); main.setIgnoreMouseEvents(true); main.showInactive();
  // Exercise the shipped React controls, not just the IPC API.
  const waitFor = async (expression: string) => {
    for (let i = 0; i < 50; i++) {
      if (await main.webContents.executeJavaScript(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Renderer condition not met: " + expression);
  };
  await waitFor("!!document.querySelector('.focus-clock')");
  const retiredUi = /Windows settings|recommended|recommendation|Track extra work|Start suggested|priority|bedtime|outing/i;
  assert.doesNotMatch(await main.webContents.executeJavaScript("document.body.innerText"), retiredUi);
  assert.equal(await main.webContents.executeJavaScript("!!document.querySelector('.day-settings, .desktop-settings')"), false);
  assert.equal(await main.webContents.executeJavaScript("typeof window.desktop.settings"), "undefined");
  assert.equal(await main.webContents.executeJavaScript("!!document.querySelector('input[aria-describedby=minimum-hint]')"), false);
  await waitFor("!!document.querySelector('button[aria-keyshortcuts=Q]') && !document.querySelector('button[aria-keyshortcuts=Q]').disabled");
  await main.webContents.executeJavaScript("document.querySelector('button[aria-keyshortcuts=Q]').click()");
  await waitFor("!!document.querySelector('.quickadd-input')");
  await main.webContents.executeJavaScript(`{
    const input=document.querySelector('.quickadd-input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Windows smoke test 2099-01-01');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  }`);
  await waitFor("!document.querySelector('.quickadd button.btn-primary').disabled");
  await main.webContents.executeJavaScript("document.querySelector('.quickadd button.btn-primary').click()");
  await waitFor("window.desktop.snapshot().then(v => v.state.tasks.some(t => t.title === 'Windows smoke test'))");
  await waitFor("!document.querySelector('.focus-action').disabled");
  assert.match(await main.webContents.executeJavaScript("document.body.innerText"), /tracked/);
  main.webContents.reload(); await ready(main);
  await waitFor("!!document.querySelector('.focus-action') && !document.querySelector('.focus-action').disabled");
  assert.match(await main.webContents.executeJavaScript("document.body.innerText"), /Windows smoke test/);
  // Retention and ordering through the shipped UI and this disposable store.
  await main.webContents.executeJavaScript(`{
    const key='yantasks.tasks.v1', tasks=JSON.parse(localStorage.getItem(key));
    const make=(id,at,due)=>({id,title:id,description:'',dueDate:due,priority:'low',completed:true,completedAt:at,createdAt:new Date().toISOString()});
    tasks.push(make('Older completion',new Date(Date.now()-86400000).toISOString(),'2020-01-01'),
      make('Newest completion',new Date().toISOString(),'2099-12-31'),
      make('Expired completion','2020-01-01T00:00:00Z','2020-01-01'));
    localStorage.setItem(key,JSON.stringify(tasks));
  }`);
  main.webContents.reload(); await ready(main);
  await waitFor("document.querySelectorAll('.completed-tasks .task-title').length === 2");
  assert.deepEqual(await main.webContents.executeJavaScript("Array.from(document.querySelectorAll('.completed-tasks .task-title'),e=>e.textContent)"), ["Newest completion", "Older completion"]);
  assert.equal(await main.webContents.executeJavaScript("JSON.parse(localStorage.getItem('yantasks.tasks.v1')).some(t=>t.id==='Expired completion')"), false);
  await main.webContents.executeJavaScript("document.querySelector('.completed-tasks').open=true; document.querySelector('input[aria-label=\"Complete Windows smoke test\"]').click()");
  await waitFor("document.querySelector('.completed-tasks .task-title')?.textContent === 'Windows smoke test'");
  await main.webContents.executeJavaScript("document.querySelector('input[aria-label=\"Reopen Windows smoke test\"]').click()");
  await waitFor("document.querySelectorAll('.completed-tasks .task-title').length === 2 && !document.querySelector('.focus-action').disabled");
  console.log("RETENTION CHECK PASS: expired records deleted, newest completions first, reopening preserved.");
  assert.deepEqual(await main.webContents.executeJavaScript("Array.from(document.querySelectorAll('.app-footer a'), a => a.href)"),
    ["https://tasks.ethanyanxu.com/support", "https://tasks.ethanyanxu.com/privacy"]);
  await assert.rejects(main.webContents.executeJavaScript("window.desktop.api({path:'https://example.com', method:'GET'})"));
  await assert.rejects(main.webContents.executeJavaScript("window.desktop.command({type:'start',taskId:'arbitrary'})"));
  await assert.rejects(main.webContents.executeJavaScript("window.desktop.command({type:'continue'})"));
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
  await main.webContents.executeJavaScript("document.querySelector('.focus-action').click()");
  await waitFor("window.desktop.snapshot().then(v => v.state.mode === 'work')");
  assert.equal(engine.view().state.mode, "work");
  if (process.argv.includes("--screenshot")) {
    // Only the freshly created smoke profile is captured, never an installed
    // app window. Keep fixture windows transparent and click-through.
    const directory = app.getPath("userData");
    assert.ok(path.basename(directory).startsWith("yantasks-smoke-"));
    mini.setOpacity(0); mini.setIgnoreMouseEvents(true); mini.showInactive();
    await new Promise(resolve => setTimeout(resolve, 150));
    for (const [name, window] of [["rotation-main", main], ["rotation-mini", mini]] as const) {
      const target = path.join(directory, `${name}.png`);
      fs.writeFileSync(target, (await window.webContents.capturePage()).toPNG());
      console.log(`SMOKE SCREENSHOT: ${target}`);
    }
  }
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
    await main.webContents.executeJavaScript("window.desktop.command({type:'start'})");
    for (const [w, selector] of [[main, ".focus-clock"], [mini, ".mini-clock"]] as const) {
      main.hide(); mini.hide();
      w.setOpacity(0); w.setIgnoreMouseEvents(true); w.showInactive();
      await sleep(250);
      const before = await readSeconds(w, selector);
      await sleep(3200);
      const after = await readSeconds(w, selector);
      assert.ok(before - after >= 2 && before - after <= 4, selector + " counts down while explicitly tracking");
      assert.equal(engine.view().state.mode, "work");
      assert.ok(engine.view().state.workMs > 0);
    }
    await main.webContents.executeJavaScript("window.desktop.command({type:'pause'})");
    const worked = engine.view().state.workMs;
    for (const [w, selector] of [[main, ".focus-clock"], [mini, ".mini-clock"]] as const) {
      main.hide(); mini.hide(); w.showInactive(); await sleep(250);
      const before = await readSeconds(w, selector);
      await sleep(3200);
      const after = await readSeconds(w, selector);
      assert.equal(after, before, selector + " leaves a paused turn still");
      assert.equal(engine.view().state.workMs, worked);
      const text = await w.webContents.executeJavaScript("document.body.innerText");
      assert.match(text, /Paused|PAUSED/); assert.doesNotMatch(text, retiredUi);
    }
    main.hide(); mini.hide();
    await sleep(100);
    const before = { ...stats };
    await sleep(2200);
    assert.equal(stats.publishes, before.publishes, "hidden idle returns to the low-power wake schedule");
    assert.equal(stats.sends, before.sends, "hidden renderers receive no countdown IPC");
    console.log("COUNTDOWN CHECK PASS: main and mini count down explicit work, remain still while paused, and stay quiet when hidden.");
  }
  await assert.rejects(mini.webContents.executeJavaScript("window.desktop.api({path:'/api/auth/me',method:'GET'})"));
  assert.doesNotMatch(await mini.webContents.executeJavaScript("document.body.innerText"), retiredUi);
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
  main.showInactive(); mini.setOpacity(0); mini.setIgnoreMouseEvents(true); mini.showInactive();
  await new Promise(resolve => setTimeout(resolve, 150));
  const mainImage = await main.webContents.capturePage();
  fs.writeFileSync(path.join(app.getPath("userData"), "main.png"), mainImage.toPNG());
  const image = await mini.webContents.capturePage();
  const imagePath = path.join(app.getPath("userData"), "mini.png");
  fs.writeFileSync(imagePath, image.toPNG());
  console.log(`SMOKE PASS: isolated guest, sandbox, IPC allowlist, shared tracker, hidden-window tracking, mini controls, icons, tray. Screenshot: ${imagePath}`);
}
