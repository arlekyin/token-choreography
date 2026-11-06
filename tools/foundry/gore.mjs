/**
 * Кровь в бою на тестовой сцене «TC-тест: кровь»: настоящие броски атаки dnd5e (activity.rollAttack).
 * Брызги и пятна на земле, кровь на клинке (слоями — бандит и слизь), скелет — пыль без крови и чистый клинок,
 * раны на портрете, лужа под павшим растекается, кровавые следы через лужу, стряхивание по простою в бою,
 * чистка после боя, настройка «Кровь: нет». Снимки — tools/foundry/out/gore-*.png.
 *
 *   node tools/foundry/gore.mjs
 */

import { connect, checker } from "./harness.mjs";

const { page, shot, close, log } = await connect();
const { check, summary } = checker();
const api = 'game.modules.get("token-choreography").api';
const ev = (fn, arg) => page.evaluate(fn, arg);

try {
  await ev(async () => {
    for (const s of game.scenes.filter(s => s.name.startsWith("TC-тест"))) await s.delete();
    for (const a of game.actors.filter(a => a.name.startsWith("TC-тест"))) await a.delete();
    for (const c of game.combats.contents) await c.delete();
    const scene = await Scene.create({ name: "TC-тест: кровь", width: 1200, height: 700, padding: 0, grid: { size: 100, type: 1 }, backgroundColor: "#6b7a4f" });
    await scene.view();
    const pack = game.packs.get("dnd5e.monsters");
    const byName = async n => (await pack.getDocument(pack.index.find(e => (e.originalName ?? e.name) === n || e.name === n)._id)).toObject();
    const weapon = async id => { const w = (await fromUuid(CONFIG.DND5E.weaponIds[id])).toObject(); w.system.equipped = true; return w; };
    const [bandit, skeleton, ooze] = await Promise.all(["Bandit", "Skeleton", "Gray Ooze"].map(byName));
    const [hero, ban, ske, slime] = await Actor.createDocuments([
      { name: "TC-тест: герой", type: "npc", img: "systems/dnd5e/tokens/humanoid/Knight.webp", items: await Promise.all(["longsword", "maul", "halberd"].map(weapon)),
        system: { attributes: { hp: { value: 60, max: 60 } } }, prototypeToken: { texture: { src: "systems/dnd5e/tokens/humanoid/Knight.webp" } } },
      { ...bandit, name: "TC-тест: бандит" },
      { ...skeleton, name: "TC-тест: скелет" },
      { ...ooze, name: "TC-тест: слизь" }
    ]);
    for (const a of [ban, ske, slime]) await a.update({ "system.attributes.hp.max": 200, "system.attributes.hp.value": 200, "system.attributes.ac.calc": "flat", "system.attributes.ac.flat": 1 });
    const tok = async (actor, x, y) => (await actor.getTokenDocument({ x, y, name: actor.name, actorLink: true })).toObject();
    await scene.createEmbeddedDocuments("Token", [await tok(hero, 400, 300), await tok(ban, 600, 300), await tok(ske, 400, 100), await tok(slime, 400, 500)]);
    if (game.paused) game.togglePause(false, { broadcast: true });
    document.querySelectorAll("#pause, .paused, #notifications").forEach(e => e.style.display = "none");
    for (const id of ["interface"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
    await game.settings.set("token-choreography", "gore", "full");
    await new Promise(r => setTimeout(r, 800));
    canvas.animatePan({ x: 550, y: 330, scale: 1.25, duration: 0 });
  });
  await page.waitForTimeout(800);

  /** Атака героя предметом item по цели target; ждём её конца */
  const attack = async (itemId, target, { midShot = null, config = {} } = {}) => {
    await ev(async ([itemId, target, config]) => {
      const t = canvas.tokens.placeables.find(t => t.name === "TC-тест: герой");
      canvas.tokens.placeables.find(t => t.name === target).setTarget(true, { releaseOthers: true });
      const item = t.actor.items.find(i => i.system.type?.baseItem === itemId);
      await item.system.activities.getByType("attack")[0].rollAttack(config, { configure: false }, {});
    }, [itemId, target, config]);
    await page.waitForFunction(() => !!canvas.tokens.placeables.find(t => t.name === "TC-тест: герой")._choreo?.act, null, { timeout: 20000 }).catch(() => {});
    if (midShot) {
      await page.waitForTimeout(midShot.after ?? 450);
      await shot(midShot.name, await clip());
    }
    await page.waitForFunction(() => !canvas.tokens.placeables.find(t => t.name === "TC-тест: герой")._choreo?.act, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(900);
  };
  const clip = () => ev(() => {
    const p = canvas.stage.worldTransform.apply(new PIXI.Point(550, 330)), r = canvas.app.view.getBoundingClientRect();
    return { x: Math.round(r.left + p.x - 420), y: Math.round(r.top + p.y - 330), width: 840, height: 660 };
  });
  const state = () => ev(new Function(`
    const g = ${api}.gore, hero = canvas.tokens.placeables.find(t => t.name === "TC-тест: герой");
    const st = k => { const s = g.stainOf(hero.document.id, k); return s ? { gore: +s.gore.toFixed(3), layers: s.layers.map(x => x.id) } : null; };
    return { ...g.decals.stats, drops: g.spray.drops.length, prints: g.decals.printCount, sword: st("sword"), maul: st("maul"), act: hero._choreo?.act?.constructor?.name ?? null };
  `));

  // ---------- Меч по бандиту: брызги и пятна, клинок в крови
  await attack("longsword", "TC-тест: бандит");
  let s = await state();
  check("меч по бандиту: на земле пятна (расписаны куски земли)", s.chunks > 0, JSON.stringify(s));
  check("меч по бандиту: клинок в крови бандита", s.sword?.gore > 0.05 && s.sword.layers.join() === "blood", JSON.stringify(s.sword));
  await attack("longsword", "TC-тест: бандит", { midShot: { name: "gore-sword-blade", after: 380 } });

  // ---------- По слизи: второй слой на клинке
  await attack("longsword", "TC-тест: слизь");
  s = await state();
  check("меч по слизи: на клинке два слоя — кровь, сверху слизь", s.sword?.layers.join() === "blood,ooze", JSON.stringify(s.sword));

  // ---------- Скелет: пыль, клинок не пачкается
  const before = s.sword.gore;
  await attack("longsword", "TC-тест: скелет");
  s = await state();
  check("меч по скелету: клинок не пачкается (кость не течёт)", Math.abs(s.sword.gore - before) < 1e-6, JSON.stringify({ before, after: s.sword }));

  // ---------- Раны на портрете
  const hurt = await ev(new Function(`return (async () => {
    const b = canvas.tokens.placeables.find(t => t.name === "TC-тест: бандит");
    await b.actor.update({ "system.attributes.hp.value": 60 });
    for (let i = 0; i < 20 && !${api}.gore.wounds.has(b.document.id); i++) await new Promise(r => setTimeout(r, 100));
    return ${api}.gore.wounds.has(b.document.id);
  })()`));
  check("бандит на 30% ПЗ: раны на портрете", hurt);
  await page.waitForTimeout(300);
  await shot("gore-wounds", await clip());

  // ---------- Смерть: лужа растекается
  const pool = await ev(new Function(`return (async () => {
    const b = canvas.tokens.placeables.find(t => t.name === "TC-тест: бандит"), g = ${api}.gore;
    await b.actor.update({ "system.attributes.hp.value": 0 });
    await new Promise(r => setTimeout(r, 1500));
    const mid = { ...g.decals.stats, r: +g.decals.pools[0]?.r.toFixed(1) };
    await new Promise(r => setTimeout(r, 11000));
    return { mid, end: { ...g.decals.stats, r: +g.decals.pools[0]?.r.toFixed(1) } };
  })()`));
  check("бандит пал: лужа растекается, потом впечатывается в землю", pool.mid.growing === 1 && pool.end.growing === 0 && pool.end.r > pool.mid.r, JSON.stringify(pool));
  await shot("gore-pool", await clip());

  // ---------- Кровавые следы: герой идёт через лужу
  const prints0 = (await state()).prints;
  const moved = await ev(async () => {
    const t = canvas.tokens.placeables.find(t => t.name === "TC-тест: герой");
    // Мимо клетки павшего (не через неё), по краю лужи
    const ok = await t.document.move([{ x: 900, y: 220 }]);
    await new Promise(r => setTimeout(r, 3000));
    return { ok: !!ok, x: t.document.x };
  });
  await page.waitForTimeout(4500);
  s = await state();
  check("через лужу: кровавые следы ног", s.prints > prints0, JSON.stringify({ prints0, after: s.prints, moved }));
  await shot("gore-prints", await clip());

  // ---------- Стряхивание по простою в бою
  await ev(async () => {
    const t = canvas.tokens.placeables.find(t => t.name === "TC-тест: герой");
    await t.document.update({ x: 400, y: 300 }, { animate: false });
    const combat = await Combat.create({ scene: canvas.scene.id, active: true });
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId: t.document.id, sceneId: canvas.scene.id, actorId: t.actor.id }]);
    await combat.startCombat();
  });
  await page.waitForTimeout(500);
  const g0 = (await state()).sword.gore;
  await ev(new Function(`${api}.testing.idleShake = 2;`));
  await page.waitForFunction(() => canvas.tokens.placeables.find(t => t.name === "TC-тест: герой")._choreo?.act?.constructor?.name === "Flourish", null, { timeout: 12000 }).catch(() => {});
  const flourishing = (await state()).act;
  await page.waitForTimeout(950);
  await shot("gore-flourish", await clip());
  await page.waitForFunction(() => !canvas.tokens.placeables.find(t => t.name === "TC-тест: герой")._choreo?.act, null, { timeout: 8000 }).catch(() => {});
  await ev(new Function(`${api}.testing.idleShake = null;`));
  s = await state();
  check("в бою без дела: стряхивает кровь, на клинке её меньше", flourishing === "Flourish" && s.sword.gore < g0, JSON.stringify({ flourishing, g0, after: s.sword }));

  // ---------- Молот: кровь на навершии и свой жест
  await attack("maul", "TC-тест: слизь", { config: { attackMode: "twoHanded" } });
  s = await state();
  check("молот по слизи: навершие в слизи", s.maul?.layers.join() === "ooze", JSON.stringify(s.maul));

  // ---------- Конец боя: оружие чистое
  await ev(async () => { for (const c of game.combats.contents) await c.delete(); });
  await page.waitForTimeout(300);
  s = await state();
  check("бой кончился: оружие чистое", !s.sword && !s.maul, JSON.stringify(s));

  // ---------- Настройка «Кровь: нет»
  await ev(async () => { await game.settings.set("token-choreography", "gore", "off"); });
  await ev(new Function(`${api}.cleanGround();`));
  await attack("longsword", "TC-тест: слизь");
  s = await state();
  check("«Кровь: нет»: ни пятен, ни крови на клинке", s.chunks === 0 && !s.sword, JSON.stringify(s));
  await ev(async () => { await game.settings.set("token-choreography", "gore", "full"); });
} catch (err) {
  console.error(err);
  check("проверка дошла до конца", false, String(err));
}
const errors = log.filter(l => /token-choreography|gore|STACK|pageerror|hooked function/i.test(l));
if (process.argv.includes("--log")) console.log(log.filter(l => !/аппаратное/.test(l)).join(String.fromCharCode(10)));
check("ошибок модуля в консоли нет", !errors.length, errors.slice(0, 3).join(" | "));
summary();
await close();
