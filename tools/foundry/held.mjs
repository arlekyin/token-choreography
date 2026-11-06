/**
 * Оружие в руках в бою: сцена «TC-тест: в руках». Начало боя — участники держат надетое оружие (под токеном),
 * монстр без оружия — нет; ход — оружие идёт за токеном; атака — бьёт тем же оружием и возвращает его в руки;
 * кнопка на панели токена убирает и достаёт; конец боя — убирают. Мушкет и пистоль — замком вверх.
 *
 *   node tools/foundry/held.mjs
 */

import { connect, checker, args } from "./harness.mjs";

const { page, log, shot, close } = await connect();
const { check, summary } = checker();
const only = args().only?.split(","), want = n => !only || only.includes(n);

try {
  await page.evaluate(async () => {
    for (const c of game.combats.contents) await c.delete();
    for (const s of game.scenes.filter(s => s.name.startsWith("TC-тест"))) await s.delete();
    for (const a of game.actors.filter(a => a.name.startsWith("TC-тест"))) await a.delete();
    const scene = await Scene.create({ name: "TC-тест: в руках", width: 1000, height: 600, padding: 0, grid: { size: 100, type: 1 }, backgroundColor: "#6b7a4f" });
    await scene.view();
    const pack = game.packs.get("dnd5e.monsters");
    const byName = async n => (await pack.getDocument(pack.index.find(e => (e.originalName ?? e.name) === n || e.name === n)._id)).toObject();
    const weapon = async id => { const w = (await fromUuid(CONFIG.DND5E.weaponIds[id])).toObject(); w.system.equipped = true; return w; };
    const img = "systems/dnd5e/tokens/humanoid/Knight.webp";
    const [hero, gunner, pistoleer, zom, ban] = await Actor.createDocuments([
      { name: "TC-тест: герой", type: "npc", img, items: [await weapon("longsword")], prototypeToken: { texture: { src: img } } },
      { name: "TC-тест: стрелок", type: "npc", img, items: [await weapon("musket")], prototypeToken: { texture: { src: img } } },
      { name: "TC-тест: дуэлянт", type: "npc", img, items: [await weapon("pistol")], prototypeToken: { texture: { src: img } } },
      { ...(await byName("Zombie")), name: "TC-тест: зомби" },
      { ...(await byName("Bandit")), name: "TC-тест: бандит" }
    ]);
    const tok = async (actor, x, y) => (await actor.getTokenDocument({ x, y, name: actor.name, actorLink: true })).toObject();
    await scene.createEmbeddedDocuments("Token", [await tok(hero, 300, 200), await tok(gunner, 300, 400), await tok(pistoleer, 700, 400),
      await tok(zom, 700, 200), await tok(ban, 500, 300)]);
    if (game.paused) game.togglePause(false, { broadcast: true });
    for (const id of ["notifications", "pause"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
    await new Promise(r => setTimeout(r, 800));
    canvas.animatePan({ x: 500, y: 300, scale: 1.2, duration: 0 });
  });
  await page.waitForTimeout(800);
  const T = n => `canvas.tokens.placeables.find(t => t.name === "TC-тест: ${n}")`;
  const state = () => page.evaluate(() => {
    const out = {};
    for (const t of canvas.tokens.placeables) {
      const v = t._choreo, r = v?.rig;
      out[t.name.replace("TC-тест: ", "")] = r ? { key: r.key, held: !!r.held, leaving: !!r.leaving, layer: (r.main ?? r.gfx)?.parent?.sortLayer, mir: r.mir } : null;
    }
    return out;
  });

  check("до боя оружия в руках нет", Object.values(await state()).every(r => !r || r.leaving), JSON.stringify(await state()));

  // Бой: герой, бандит, стрелок, дуэлянт (зомби — нет)
  await page.evaluate(async () => {
    const names = ["герой", "бандит", "стрелок", "дуэлянт"].map(n => `TC-тест: ${n}`);
    const combat = await Combat.create({ scene: canvas.scene.id, active: true });
    await combat.createEmbeddedDocuments("Combatant", canvas.tokens.placeables.filter(t => names.includes(t.name)).map(t => ({ tokenId: t.id, sceneId: canvas.scene.id, actorId: t.actor.id })));
    await combat.startCombat();
  });
  await page.waitForTimeout(1500);
  let s = await state();
  check("в бою герой держит меч (под токеном)", s["герой"]?.held && s["герой"].key?.startsWith("m:sword") && s["герой"].layer === 699, JSON.stringify(s["герой"]));
  check("в бою бандит держит своё оружие", s["бандит"]?.held, JSON.stringify(s["бандит"]));
  check("стрелок держит мушкет, дуэлянт — пистоль", s["стрелок"]?.key === "r:musket" && s["дуэлянт"]?.key === "r:pistol", JSON.stringify([s["стрелок"], s["дуэлянт"]]));
  check("зомби (не в бою, без оружия) — ничего", !s["зомби"]);
  await shot("held-combat");

  if (want("walk")) {
    // Ход: оружие идёт за токеном (рукоять рядом с мешем, а не на месте назначения)
    const far = await page.evaluate(async t => {
      const tok = eval(t); window.tcFar = 0;
      const f = () => { const r = tok._choreo?.rig, g = r?.grip?.(), u = canvas.dimensions.size / 100; if (g) window.tcFar = Math.max(window.tcFar, Math.hypot(g.x * u - tok.mesh.x, g.y * u - tok.mesh.y)); };
      canvas.app.ticker.add(f);
      await tok.document.move([{ x: 300, y: 100 }]);
      await new Promise(r => setTimeout(r, 2500));
      canvas.app.ticker.remove(f);
      return window.tcFar;
    }, T("герой"));
    check("ход: оружие идёт за токеном", far < 90, `дальше всего ${far.toFixed(0)} px от меша`);
  }

  if (want("attack")) {
    // Атака мечом: бьёт тем же оружием и возвращает в руки
    const r = await page.evaluate(async ([h, b]) => {
      const hero = eval(h), ban = eval(b), rig0 = hero._choreo.rig;
      await ban.actor.update({ "system.attributes.ac.calc": "flat", "system.attributes.ac.flat": 1 });
      ban.setTarget(true, { releaseOthers: true });
      const item = hero.actor.items.find(i => i.system.type?.baseItem === "longsword");
      let sawAct = false, sameInAttack = true;
      const f = () => { if (hero._choreo.act) { sawAct = true; if (hero._choreo.rig !== rig0) sameInAttack = false; } };
      canvas.app.ticker.add(f);
      await item.system.activities.getByType("attack")[0].rollAttack({}, { configure: false }, {});
      for (let i = 0; i < 80 && (!sawAct || hero._choreo.act); i++) await new Promise(r => setTimeout(r, 150));
      await new Promise(r => setTimeout(r, 800));
      canvas.app.ticker.remove(f);
      const rig = hero._choreo.rig;
      return { sawAct, sameInAttack, sameAfter: rig === rig0, held: !!rig?.held, leaving: !!rig?.leaving };
    }, [T("герой"), T("бандит")]);
    check("атака: бьёт тем же оружием, что в руках", r.sawAct && r.sameInAttack, JSON.stringify(r));
    check("после атаки оружие снова в руках", r.sameAfter && r.held && !r.leaving, JSON.stringify(r));
  }

  if (want("guns")) {
    // Мушкет и пистоль: выстрел по бандиту, замок сверху (зеркало по стороне замка и направлению ствола)
    for (const who of ["стрелок", "дуэлянт"]) {
      const r = await page.evaluate(async ([g, b]) => {
        const gun = eval(g), ban = eval(b);
        ban.setTarget(true, { releaseOthers: true });
        const item = gun.actor.items.find(i => i.type === "weapon");
        const mirs = [];
        const f = () => { const r = gun._choreo.rig; if (gun._choreo.act && r?.geo) { const G = r.geo(); mirs.push({ cos: Math.cos(G.ang), mir: G.mir, lock: r.meta.lock, dir: +gun._choreo.act.dir?.toFixed?.(2), face: +r.face.toFixed(2), up: +r.up.p.toFixed(2) }); } };
        canvas.app.ticker.add(f);
        await item.system.activities.getByType("attack")[0].rollAttack({}, { configure: false }, {});
        for (let i = 0; i < 100 && (!mirs.length || gun._choreo.act); i++) await new Promise(r => setTimeout(r, 150));
        canvas.app.ticker.remove(f);
        // Замок сверху по экрану: для замка слева на картинке ствол вправо — без зеркала, влево — с зеркалом
        const ok = mirs.length && mirs.every(q => q.mir === ((q.cos >= 0) === (q.lock === "left") ? 1 : -1));
        return { n: mirs.length, ok, first: mirs[0], mid: mirs[Math.floor(mirs.length / 2)], last: mirs.at(-1) };
      }, [T(who), T("бандит")]);
      check(`${who}: при выстреле замок сверху`, r.ok, JSON.stringify(r));
    }
  }

  if (want("hud")) {
    // Кнопка на панели токена: есть; убрать — оружие уходит; правый клик — снова как в бою
    const r = await page.evaluate(async h => {
      const hero = eval(h);
      hero.control({ releaseOthers: true });
      await canvas.hud.token.bind(hero);
      await new Promise(r => setTimeout(r, 400));
      const btn = [...canvas.hud.token.element.querySelectorAll(".col.left button")].find(b => b.querySelector(".fa-hand-back-fist, .fa-hand"));
      const had = !!btn, active = btn?.classList.contains("active");
      btn?.click();
      await new Promise(r => setTimeout(r, 1200));
      const off = { flag: hero.document.getFlag("token-choreography", "armed"), leaving: !!hero._choreo.rig?.leaving || !hero._choreo.rig };
      const btn2 = [...canvas.hud.token.element.querySelectorAll(".col.left button")].find(b => b.querySelector(".fa-hand-back-fist, .fa-hand"));
      btn2?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
      await new Promise(r => setTimeout(r, 1500));
      const back = { flag: hero.document.getFlag("token-choreography", "armed"), held: !!hero._choreo.rig?.held && !hero._choreo.rig?.leaving };
      canvas.hud.token.close();
      return { had, active, off, back };
    }, T("герой"));
    check("на панели токена есть кнопка оружия (горит в бою)", r.had && r.active, JSON.stringify(r));
    check("кнопка: убрать — оружие уходит", r.off.flag === false && r.off.leaving, JSON.stringify(r.off));
    check("правый клик: снова как в бою — в руках", r.back.flag === undefined && r.back.held, JSON.stringify(r.back));
  }

  // Конец боя — оружие убирают
  await page.evaluate(async () => { for (const c of game.combats.contents) await c.delete(); });
  await page.waitForTimeout(1500);
  s = await state();
  check("после боя оружие убрано", Object.values(s).every(r => !r || r.leaving), JSON.stringify(s));
  const errs = log.filter(l => /pageerror|token-choreography|STACK/.test(l));
  check("нет ошибок модуля на странице", !errs.length, errs.slice(0, 2).join(" | "));
} catch (err) {
  check("проверка дошла до конца", false, err.message);
  console.log(log.slice(-10).join("\n"));
} finally {
  const bad = summary();
  await close();
  process.exit(bad ? 1 : 0);
}
