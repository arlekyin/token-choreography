/** Пошаговая проба в тестовом мире: состояние модуля, одна сцена, один ход */
import { connect } from "./harness.mjs";

const { page, log, close } = await connect();
const step = async (name, fn, arg) => {
  console.log("→", name);
  try { console.log("  ", JSON.stringify(await page.evaluate(fn, arg))); }
  catch (e) {
    console.log("  ✘", e.message);
    console.log(log.filter(l => !/^warning/.test(l)).slice(-5).join("\n"));
    await close(); process.exit(1);
  }
};
await step("состояние", () => ({ scene: canvas.scene?.name, tokens: canvas.tokens?.placeables.length, cls: CONFIG.Token.objectClass.name, active: game.modules.get("token-choreography").active }));
await step("создать сцену", async () => {
  for (const s of game.scenes.filter(s => s.name.startsWith("TC-тест"))) await s.delete();
  const scene = await Scene.create({ name: "TC-тест: ход", width: 1400, height: 900, padding: 0, grid: { size: 100, type: 1 }, backgroundColor: "#6b7a4f" });
  return scene.id;
});
await step("показать сцену", async () => { await game.scenes.getName("TC-тест: ход").view(); return canvas.scene?.name; });
await step("токены", async () => {
  const mk = (name, x, y, size) => ({ name, x, y, width: size, height: size, texture: { src: "icons/svg/mystery-man.svg" } });
  await canvas.scene.createEmbeddedDocuments("Token", [mk("Средний", 100, 100, 1)]);
  await new Promise(r => setTimeout(r, 800));
  return canvas.tokens.placeables.map(t => t.name);
});
await step("ход", async () => {
  const t = canvas.tokens.placeables[0];
  window.tcDur = [];
  const orig = t.animate.bind(t);
  t.animate = (to, o = {}) => { const r = orig(to, o); window.tcDur.push({ to, name: o.name === t.movementAnimationName, plan: !!t._choreoPlan }); return r; };
  const realPlan = t._choreoPlan;
  t.document.move([{ x: 400, y: 100 }, { x: 400, y: 300 }]);
  await new Promise(r => setTimeout(r, 300));
  const mo = t._choreo?.motion;
  window.tcInfo = { time: mo?.time, total: mo?.total, logicalEnd: mo?.logicalEnd, legs: mo?.legs.map(e => [e.leg.constructor.name, e.start, e.leg.pre, e.leg.dur, e.leg.post]), calls: window.tcDur, ticker: canvas.app.ticker.started };
  const m = t.mesh;
  return { info: window.tcInfo, motion: !!t._choreo?.motion, sx: m.scale.x, sy: m.scale.y, kx: m.skew.x, x: m.x, docx: t.document.x };
});
await step("после хода", async () => {
  await new Promise(r => setTimeout(r, 2500));
  const t = canvas.tokens.placeables[0];
  const mo = t._choreo?.motion; return { time: mo?.time, motion: !!t._choreo?.motion, x: t.mesh.x, y: t.mesh.y, c: t.document.getCenterPoint() };
});
console.log(log.filter(l => /pageerror|token-choreography/.test(l)).join("\n") || "ошибок нет");
await close();
