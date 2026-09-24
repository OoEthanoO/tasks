import { app, session, type BrowserWindow, type NativeImage, type Tray } from "electron";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import type { TrackerEngine } from "./engine";
import type { ApiReply } from "./contract";

export async function runSmoke({ main, mini, engine, icons, request, tray }: { main: BrowserWindow; mini: BrowserWindow; engine: TrackerEngine; icons: Record<string, NativeImage>; request: (path: string) => Promise<ApiReply>; tray: Tray }) {
  const ready = async (w: BrowserWindow) => {
    if (w.webContents.isLoading()) await new Promise<void>(resolve => w.webContents.once("did-finish-load", () => resolve()));
    for (let i = 0; i < 50; i++) {
      if (await w.webContents.executeJavaScript("!!document.querySelector('#root')?.textContent?.length")) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Renderer did not mount.");
  };
  await Promise.all([ready(main), ready(mini)]);
  assert.ok(Object.values(icons).every(i => !i.isEmpty()), "all native icons loaded");
  assert.ok(!tray.isDestroyed());
  const state = await main.webContents.executeJavaScript("({text:document.body.innerText, bridge:typeof window.desktop, node:typeof window.require})");
  assert.equal(state.node, "undefined"); assert.equal(state.bridge, "object");
  assert.match(state.text, /YanTasks/);
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
  await assert.rejects(mini.webContents.executeJavaScript("window.desktop.api({path:'/api/auth/me',method:'GET'})"));
  const image = await mini.webContents.capturePage();
  const imagePath = path.join(app.getPath("userData"), "mini.png");
  fs.writeFileSync(imagePath, image.toPNG());
  console.log(`SMOKE PASS: isolated guest, sandbox, IPC allowlist, shared tracker, hidden-window tracking, mini controls, icons, tray. Screenshot: ${imagePath}`);
}
