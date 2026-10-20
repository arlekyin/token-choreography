/**
 * Ход токенов на тестовой сцене «TC-тест: ход»: ходьба, полёт, прыжок, лазание, парение, размеры.
 * Снимки — в tools/foundry/out (move-*.png, раскадровки). --only=walk,fly — только эти случаи.
 *
 *   node tools/foundry/move.mjs --only=walk
 *   node tools/foundry/move.mjs
 */

import { connect, checker, args } from "./harness.mjs";

const only = args().only?.split(",");
const SLOW = args().fast ? 0 : Number(args().slow ?? 1.5);
const want = name => !only || only.includes(name);
const { page, log, shot, close } = await connect();
const { check, summary } = checker();

try {
  // Сцена: клетка 100, без стен, светлая
  await page.evaluate(async () => {
    for (const s of game.scenes.filter(s => s.name.startsWith("TC-тест"))) await s.delete();
    const scene = await Scene.create({
      name: "TC-тест: ход", width: 1400, height: 900, padding: 0, grid: { size: 100, type: 1 },
      backgroundColor: "#6b7a4f"
    });
    await scene.view();
    const T = "systems/dnd5e/tokens/";
    const mk = (name, x, y, size, src) => ({ name, x, y, width: size, height: size, texture: { src: T + src } });
    await scene.createEmbeddedDocuments("Token", [
      mk("Средний", 100, 100, 1, "humanoid/Bandit.webp"), mk("Крошечный", 100, 400, 0.5, "beast/Almiraj.webp"),
      mk("Огромный", 100, 600, 3, "beast/Allosaurus.webp"), mk("Летун", 700, 100, 1, "dragon/BlueDragonWyrmling.webp")
    ]);
    // Для снимков: без паузы и без интерфейса
    if (game.paused) game.togglePause(false, { broadcast: true });
    for (const id of ["interface", "notifications", "pause"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
    document.querySelectorAll("#pause, .paused, #notifications").forEach(e => e.style.display = "none");
    await new Promise(r => setTimeout(r, 800));
    canvas.animatePan({ x: 700, y: 450, scale: 0.85, duration: 0 });
  });
  await page.waitForTimeout(800);
  console.log("сцена готова");
  check("модуль активен, класс токена дополнен", await page.evaluate(() =>
    game.modules.get("token-choreography").active && !!canvas.tokens.placeables[0]?.choreo));

  /** Ход с записью кадров: ход запускается, каждые step мс снимается состояние меша и экран */
  const film = async (name, tokenName, waypoints, { frames = 8, step = 120 } = {}) => {
    console.log("ход", name);
    const t0 = Date.now();
    await page.evaluate(([n, w, slow]) => {
      window.tcSamples = [];
      const t = canvas.tokens.placeables.find(t => t.name === n);
      const sample = () => {
        const m = t.mesh, v = t._choreo;
        window.tcSamples.push({ sx: m.scale.x, sy: m.scale.y, kx: m.skew.x, ky: m.skew.y, x: m.x, y: m.y,
          docX: t.document.x, alt: v?.alt ?? 0, aloft: !!v?.aloft, moving: !!v?.motion, sort: m.sort });
      };
      canvas.app.ticker.add(sample);
      window.tcStop = () => canvas.app.ticker.remove(sample);
      // Для раскадровки ход замедлен: скорость 1,5 клетки/с вместо 6 (снимки в программной отрисовке медленные)
      t.document.move(w, slow ? { animation: { movementSpeed: slow } } : {});
    }, [tokenName, waypoints, SLOW]);
    for (let i = 0; i < frames; i++) {
      await page.waitForTimeout(Math.max(0, t0 + (i + 1) * step - Date.now()));
      await shot(`move-${name}-${i}`);
    }
    await page.waitForFunction(n => { const t = canvas.tokens.placeables.find(t => t.name === n); return !t._choreo?.motion; }, tokenName, { timeout: 20000 });
    await page.waitForTimeout(600);
    return page.evaluate(n => {
      window.tcStop();
      const t = canvas.tokens.placeables.find(t => t.name === n), c = t.document.getCenterPoint();
      return { samples: window.tcSamples, end: { meshX: t.mesh.x, meshY: t.mesh.y, cx: c.x, cy: c.y, sx: t.mesh.scale.x, skew: t.mesh.skew.x + t.mesh.skew.y } };
    }, tokenName);
  };
  const deformed = s => s.some(q => Math.abs(q.kx) > 1e-3 || Math.abs(q.ky) > 1e-3 || Math.abs(q.sx - q.sy) > 1e-3);
  const settled = e => Math.abs(e.meshX - e.cx) < 0.5 && Math.abs(e.meshY - e.cy) < 0.5;

  if (want("walk")) {
    const r = await film("walk", "Средний", [{ x: 400, y: 100 }, { x: 400, y: 300 }, { x: 600, y: 300 }], { frames: 10, step: 110 });
    check("ходьба: токен искажается (присед, наклон, шаги)", deformed(r.samples));
    check("ходьба: в конце меш ровно на месте документа", settled(r.end), JSON.stringify(r.end));
    check("ходьба: путь отходит от ломаной (скруглённые повороты)", r.samples.some(q => q.moving && Math.abs(q.x - (q.docX + 50)) > 3));
  }
  if (want("sizes")) {
    const a = await film("tiny", "Крошечный", [{ x: 500, y: 400 }], { frames: 4, step: 150 });
    const b = await film("huge", "Огромный", [{ x: 500, y: 600 }], { frames: 6, step: 150 });
    check("размеры: крошечный и огромный дошли", settled(a.end) && settled(b.end));
    check("размеры: огромный идёт дольше крошечного", b.samples.length > a.samples.length, `${a.samples.length} / ${b.samples.length} кадров`);
  }
  if (want("fly")) {
    const r = await film("fly", "Летун", [{ x: 1000, y: 100, action: "fly" }, { x: 1000, y: 400, action: "fly" }], { frames: 12, step: 150 });
    check("полёт: токен в воздухе и слоем выше", r.samples.some(q => q.aloft && q.sort > 1e6));
    const after = await page.evaluate(() => { const v = canvas.tokens.placeables.find(t => t.name === "Летун")._choreo; return { aloft: v.aloft, alt: v.alt }; });
    check("полёт: после хода остаётся в воздухе", r.samples.at(-1).aloft && after.alt > 30, JSON.stringify(after));
    await page.evaluate(() => canvas.tokens.placeables.find(t => t.name === "Летун").document.update({ movementAction: "walk" }));
    await page.waitForTimeout(1500);
    await shot("move-fly-landed");
    const landed = await page.evaluate(() => { const t = canvas.tokens.placeables.find(t => t.name === "Летун"), v = t._choreo, c = t.document.getCenterPoint(); return { alt: v?.alt ?? 0, dx: t.mesh.x - c.x, dy: t.mesh.y - c.y }; });
    check("полёт: способ хода сменили на ходьбу — сел", landed.alt < 1 && Math.abs(landed.dx) < 0.5 && Math.abs(landed.dy) < 0.5, JSON.stringify(landed));
  }
  if (want("jump")) {
    const r = await film("jump", "Средний", [{ x: 900, y: 600, action: "jump" }], { frames: 8, step: 120 });
    check("прыжок: дуга (токен выше)", r.samples.some(q => q.alt > 20));
    check("прыжок: приземлился на место", settled(r.end));
  }
  if (want("climb")) {
    const r = await film("climb", "Крошечный", [{ x: 500, y: 200, action: "climb" }], { frames: 6, step: 200 });
    check("лазание: дошёл", settled(r.end));
  }
  if (want("hover")) {
    await page.evaluate(async () => {
      const t = canvas.tokens.placeables.find(t => t.name === "Летун");
      const actor = await Actor.create({ name: "TC-тест: летун", type: "npc" });
      await t.document.update({ actorId: actor.id, actorLink: false });
      await new Promise(r => setTimeout(r, 500));
      await t.document.actor.toggleStatusEffect(CONFIG.specialStatusEffects.FLY, { active: true });
    });
    await page.waitForTimeout(1200);
    const hov = await page.evaluate(() => { const v = canvas.tokens.placeables.find(t => t.name === "Летун")._choreo; return { hover: v?.hover, alt: v?.alt }; });
    check("парение: состояние «Полёт» поднимает токен", hov.hover && hov.alt > 30, JSON.stringify(hov));
    const r = await film("hover-walk", "Летун", [{ x: 1100, y: 600 }], { frames: 6, step: 150 });
    check("парение: обычный ход — летит, не садится", r.samples.every(q => q.alt > 20));
    await shot("move-hover-idle");
  }
  const errs = log.filter(l => /pageerror|token-choreography/.test(l));
  check("нет ошибок модуля на странице", !errs.length, errs.slice(0, 5).join(" | "));
} catch (err) {
  check("проверка дошла до конца", false, err.message);
  console.log(log.slice(-10).join("\n"));
} finally {
  const bad = summary();
  await close();
  process.exit(bad ? 1 : 0);
}
