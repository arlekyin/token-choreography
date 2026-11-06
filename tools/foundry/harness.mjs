/**
 * Проверка в настоящей Foundry: Playwright заходит в тестовый мир (только testrogalika) Мастером «Claude».
 *
 * Playwright берётся из node_modules этого модуля, а если его там нет — у соседнего gachadnd (только для
 * инструментов; сам модуль ни от чего не зависит). Если в Foundry запущен другой мир — останавливаемся.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const OUT = path.join(ROOT, "tools/foundry/out");
export const URL = process.env.FOUNDRY_URL ?? "http://localhost:30000";
export const WORLD = "testrogalika";
const USER = process.env.FOUNDRY_USER ?? "Claude";

async function playwright() {
  for (const base of [ROOT, path.join(ROOT, "../gachadnd")]) {
    try {
      const req = createRequire(path.join(base, "package.json"));
      const mod = await import(pathToFileURL(req.resolve("playwright")).href);
      return mod.chromium ? mod : mod.default;
    } catch {}
  }
  throw new Error("Нет Playwright: npm install в модуле (или в gachadnd)");
}

export const status = async () => (await fetch(`${URL}/api/status`)).json();

export const args = () => Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith("--")).map(a => {
  const [k, v] = a.slice(2).split("="); return [k, v ?? true];
}));

/** Тестовый мир запущен; чужой мир — ошибка. Модуль включается в мире, если выключен */
async function ensureWorld(browser) {
  let st = await status();
  if (st.active) {
    if (st.world !== WORLD) throw new Error(`Активен мир «${st.world}», а не «${WORLD}» — останавливаюсь`);
    return false;
  }
  const page = await browser.newPage();
  await page.goto(`${URL}/setup`);
  const play = `[data-package-id="${WORLD}"] .control.play`;
  await page.waitForSelector(play, { state: "attached", timeout: 60000 });
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelectorAll(".tour-overlay, .tour-fadeout, .tour").forEach(e => e.remove()));
  await page.$eval(play, el => el.click());
  const yes = await page.waitForSelector('dialog button[data-action="yes"], dialog button[data-action="confirm"]', { timeout: 5000 }).catch(() => null);
  if (yes) await yes.click();
  await page.waitForURL(/\/(game|join)/, { timeout: 120000 });
  await page.close();
  for (let i = 0; i < 120 && !(st = await status()).active; i++) await new Promise(r => setTimeout(r, 1000));
  return true;
}

export async function connect({ width = 1400, height = 900 } = {}) {
  const { chromium } = await playwright();
  const a = args();
  const browser = await chromium.launch({
    headless: !a.headed,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  });
  const launched = await ensureWorld(browser);
  console.log("мир готов");
  // --video — ролик прогона в out/video (webm)
  const context = await browser.newContext({ viewport: { width, height }, ...(a.video ? { recordVideo: { dir: path.join(OUT, "video"), size: { width, height } } } : {}) });
  const page = await context.newPage();
  const log = [];
  page.on("pageerror", e => { log.push(`pageerror: ${e.message} ${(e.stack ?? "").split("\n").slice(1, 5).join(" ← ")}`); });
  page.on("console", m => { if (["error", "warning"].includes(m.type())) log.push(`${m.type()}: ${m.text()}`); });
  const login = async () => {
    await page.goto(`${URL}/join`);
    const select = 'select[name="userid"], select[name="userId"]';
    await page.waitForSelector(select, { timeout: 60000 });
    const id = await page.$eval(select, (el, n) => [...el.options].find(o => o.textContent.trim() === n)?.value, USER);
    await page.selectOption(select, id);
    await Promise.all([page.waitForURL(/\/game/, { timeout: 60000 }), page.click('button[name="join"]')]);
    await page.waitForFunction(() => window.game?.ready, null, { polling: 250, timeout: 120000 });
    await page.waitForTimeout(1500);
  };
  await login();
  console.log("вход выполнен");
  // Ошибки страницы — со стеком (у части ошибок Playwright стек не отдаёт)
  await page.addInitScript(() => window.addEventListener("error", e => console.error(`STACK ${e.error?.stack ?? e.message}`)));
  await page.evaluate(() => window.addEventListener("error", e => console.error(`STACK ${e.error?.stack ?? e.message}`)));
  // Модуль включается в тестовом мире и мир перезагружается
  const on = await page.evaluate(() => game.modules.get("token-choreography")?.active);
  if (!on) {
    await page.evaluate(async () => {
      const cfg = foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration"));
      cfg["token-choreography"] = true;
      await game.settings.set("core", "moduleConfiguration", cfg);
    });
    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForFunction(() => window.game?.ready, null, { polling: 250, timeout: 120000 });
    await page.waitForTimeout(1500);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const shot = (name, clip) => page.screenshot({ path: path.join(OUT, `${name}.png`), clip });
  const close = async () => {
    if (launched && !a["keep-world"]) {
      await page.evaluate(() => game.shutDown()).catch(() => {});
      for (let i = 0; i < 60 && (await status()).active; i++) await new Promise(r => setTimeout(r, 1000));
    }
    await context.close();
    await browser.close();
  };
  return { page, browser, log, shot, close };
}

export function checker() {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok: !!ok });
    console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`);
  };
  const summary = () => {
    const bad = results.filter(r => !r.ok).length;
    console.log(`\nИтог: ${results.length - bad}/${results.length}`);
    return bad;
  };
  return { check, summary };
}
