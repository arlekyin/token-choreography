/**
 * Атаки на тестовой сцене «TC-тест: атака»: настоящий бросок атаки dnd5e (activity.rollAttack) по цели.
 * Исход задаётся КД цели: КД 1 — попадание, КД 40 — промах (натуральные 1 и 20 всё равно возможны).
 * Снимки — в tools/foundry/out (attack-*.png). --only=sword-hit,slam-hit — только эти случаи.
 *
 *   node tools/foundry/attack.mjs --only=sword-hit
 *   node tools/foundry/attack.mjs
 */

import { connect, checker, args } from "./harness.mjs";

const only = args().only?.split(",");
const want = name => !only || only.includes(name);
// Шаг раскадровки, с времени атаки между снимками
const STEP = Number(args().step ?? 0.06);
const { page, log, shot, close } = await connect();
const { check, summary } = checker();

try {
  await page.evaluate(async () => {
    for (const s of game.scenes.filter(s => s.name.startsWith("TC-тест"))) await s.delete();
    for (const a of game.actors.filter(a => a.name.startsWith("TC-тест"))) await a.delete();
    const scene = await Scene.create({
      name: "TC-тест: атака", width: 1000, height: 600, padding: 0, grid: { size: 100, type: 1 },
      backgroundColor: "#6b7a4f"
    });
    await scene.view();
    // Герой с длинным мечом, зомби с ударом телом, бандит — цель со скимитаром (может парировать)
    const pack = game.packs.get("dnd5e.monsters");
    const byName = async n => (await pack.getDocument(pack.index.find(e => (e.originalName ?? e.name) === n || e.name === n)._id)).toObject();
    const zombie = await byName("Zombie"), bandit = await byName("Bandit");
    const weapon = async id => { const w = (await fromUuid(CONFIG.DND5E.weaponIds[id])).toObject(); w.system.equipped = true; return w; };
    const sword = await weapon("longsword"), rapier = await weapon("rapier"), dagger = await weapon("dagger"), greataxe = await weapon("greataxe");
    // Безоружный удар: свой предмет с атакой (классификация «без оружия»)
    const unarmed = { name: "Безоружный удар", type: "weapon", system: { identifier: "unarmed-strike", equipped: true, type: { value: "simpleM" },
      activities: { unarmedAttack000: { _id: "unarmedAttack000", type: "attack", attack: { type: { value: "melee", classification: "unarmed" } } } } } };
    // Чудище со всеми природными атаками: оружие типа «природное» с атакой (плевок — дальняя)
    const nat = (name, id, ranged = false) => ({ name, type: "weapon", system: { identifier: id, equipped: true, type: { value: "natural" },
      activities: { [`${id}Atk`.padEnd(16, "0").slice(0, 16)]: { _id: `${id}Atk`.padEnd(16, "0").slice(0, 16), type: "attack", attack: { type: { value: ranged ? "ranged" : "melee" } } } } } });
    const beastItems = [nat("Укус", "bite"), nat("Когти", "claw"), nat("Щупальце", "tentacle"), nat("Лоза", "vine"), nat("Жало", "sting"), nat("Касание", "touch"), nat("Плевок", "spit", true)];
    const [hero, zom, ban, beast] = await Actor.createDocuments([
      { name: "TC-тест: герой", type: "npc", img: "systems/dnd5e/tokens/humanoid/Knight.webp", items: [sword, rapier, dagger, greataxe, unarmed, ...await Promise.all(["longbow", "lightcrossbow", "heavycrossbow", "handcrossbow", "musket", "pistol", "javelin", "handaxe"].map(weapon))],
        prototypeToken: { texture: { src: "systems/dnd5e/tokens/humanoid/Knight.webp" } } },
      { ...zombie, name: "TC-тест: зомби" },
      { ...bandit, name: "TC-тест: бандит" },
      { name: "TC-тест: чудище", type: "npc", img: "systems/dnd5e/tokens/aberration/Otyugh.webp", items: beastItems,
        prototypeToken: { texture: { src: "systems/dnd5e/tokens/aberration/Otyugh.webp" } } }
    ]);
    const tok = async (actor, x, y) => (await actor.getTokenDocument({ x, y, name: actor.name, actorLink: true })).toObject();
    await scene.createEmbeddedDocuments("Token", [await tok(hero, 300, 200), await tok(zom, 300, 400), await tok(ban, 500, 300), await tok(beast, 700, 300)]);
    if (game.paused) game.togglePause(false, { broadcast: true });
    for (const id of ["interface", "notifications", "pause"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
    document.querySelectorAll("#pause, .paused, #notifications").forEach(e => e.style.display = "none");
    await new Promise(r => setTimeout(r, 800));
    canvas.animatePan({ x: 450, y: 300, scale: 1.4, duration: 0 });
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.tcStep = true; });
  console.log("сцена готова");

  /** Бросок атаки dnd5e от name по цели «бандит» с КД ac; кадры — пошагово, по STEP с времени атаки */
  const attack = async (name, who, itemName, ac, { frames = 16, before = null, config = {}, style = null, dodge = null } = {}) => {
    console.log("атака", name);
    const res = await page.evaluate(async ([who, itemName, ac, before, config, style, dodge]) => {
      Object.assign(game.modules.get("token-choreography").api.testing, { style, dodge });
      const t = canvas.tokens.placeables.find(t => t.name === who);
      const target = canvas.tokens.placeables.find(t => t.name === "TC-тест: бандит");
      await target.actor.update({ "system.attributes.ac.calc": "flat", "system.attributes.ac.flat": ac });
      target.setTarget(true, { releaseOthers: true });
      const item = t.actor.items.find(i => i.system.type?.baseItem === itemName || i.system.identifier === itemName || (i.originalName ?? i.name) === itemName);
      const activity = item.system.activities.getByType("attack")[0];
      // Подготовка к стилю: спрятаться (исподтишка) или подойти к цели (наскок)
      if (before === "hide") await t.actor.toggleStatusEffect("hiding", { active: true });
      if (before === "move") await t.document.move([{ x: 400, y: 200 }]);
      window.tcSamples = [];
      const a = t, b = target;
      const sample = () => {
        const va = a._choreo, vb = b._choreo;
        window.tcSamples.push({
          act: !!va?.act, style: va?.act?.style, numb: !!vb?.react?.numb, shield: !!vb?.shield?.gfx?.parent, brig: !!vb?.rig, rig: !!(va?.rig?.main ?? va?.rig?.gfx)?.parent, shift: Math.hypot(va?.shift.x ?? 0, va?.shift.y ?? 0),
          flash: !!vb?.flash?.sprite?.parent, react: !!vb?.react?.busy, bmove: Math.hypot(vb?.ox.p ?? 0, vb?.oy.p ?? 0),
          mdx: a.mesh.x - a.document.getCenterPoint().x, sx: va?.shift.x ?? 0, gx: va?.rig?.main?.x, gy: va?.rig?.main?.y, cx: a.document.getCenterPoint().x, cy: a.document.getCenterPoint().y
        });
      };
      canvas.app.ticker.add(sample);
      window.tcStop = () => canvas.app.ticker.remove(sample);
      // Для раскадровки атака замедлена (кадры в программной отрисовке медленные)
      // Пошаговая раскадровка: время атаки идёт порциями между снимками
      game.modules.get("token-choreography").api.director.budget = window.tcStep ? 0 : Infinity;
      const msgs = await activity.rollAttack(config, { configure: false }, {});
      if (before === "hide") await t.actor.toggleStatusEffect("hiding", { active: false });
      const m = game.messages.contents.at(-1);
      return { total: m?.rolls[0]?.total, nat: m?.rolls[0]?.d20?.total ?? m?.rolls[0]?.dice[0]?.total,
        targets: m?.system?.evaluatedTargets?.map(x => ({ ac: x.ac, miss: x.isMiss })), type: m?.type, ok: !!msgs };
    }, [who, itemName, ac, before, config, style, dodge]);
    // Кадры — с начала атаки (после того как кости Dice So Nice упали)
    await page.waitForFunction(w => !!canvas.tokens.placeables.find(t => t.name === w)._choreo?.act, who, { timeout: 20000 }).catch(() => {});
    // Снимок — только область вокруг атакующего и цели (так и быстрее)
    const clip = await page.evaluate(w => {
      const a = canvas.tokens.placeables.find(t => t.name === w), b = canvas.tokens.placeables.find(t => t.name === "TC-тест: бандит");
      const ca = a.document.getCenterPoint(), cb = b.document.getCenterPoint();
      const p = canvas.stage.worldTransform.apply(new PIXI.Point((ca.x + cb.x) / 2, (ca.y + cb.y) / 2));
      const r = canvas.app.view.getBoundingClientRect();
      return { x: Math.round(r.left + p.x - 260), y: Math.round(r.top + p.y - 200), width: 520, height: 400 };
    }, who);
    for (let i = 0; i < frames; i++) {
      await page.evaluate(s => { game.modules.get("token-choreography").api.director.budget = s; }, STEP);
      await page.waitForFunction(() => game.modules.get("token-choreography").api.director.budget <= 1e-6, null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(80);
      await shot(`attack-${name}-${i}`, clip);
    }
    await page.evaluate(() => { game.modules.get("token-choreography").api.director.budget = Infinity; });
    await page.waitForFunction(w => !canvas.tokens.placeables.find(t => t.name === w)._choreo?.act, who, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const end = await page.evaluate(w => {
      window.tcStop();
      Object.assign(game.modules.get("token-choreography").api.testing, { style: null, dodge: null });
      game.modules.get("token-choreography").api.director.budget = Infinity;
      const t = canvas.tokens.placeables.find(t => t.name === w), c = t.document.getCenterPoint();
      return { samples: window.tcSamples, dx: t.mesh.x - c.x, dy: t.mesh.y - c.y, rig: !!t._choreo?.rig };
    }, who);
    console.log("  бросок", JSON.stringify(res));
    if (args().debug) for (const q of end.samples.filter((q, i) => i % 6 === 0 && q.act)) console.log("   ", JSON.stringify(q));
    return { res, ...end };
  };
  const settled = e => Math.abs(e.dx) < 0.5 && Math.abs(e.dy) < 0.5 && !e.rig;

  if (want("sword-hit")) {
    const r = await attack("sword-hit", "TC-тест: герой", "longsword", 1);
    check("меч, попадание: сообщение атаки dnd5e", r.res.type === "attack" && r.res.targets?.length === 1, JSON.stringify(r.res));
    check("меч: оружие в руке видно в атаке", r.samples.some(q => q.rig));
    check("меч: атакующий подходит и возвращается", r.samples.some(q => q.shift > 10) && settled(r), `max ${Math.max(...r.samples.map(q => q.shift)).toFixed(1)}`);
    if (!r.res.targets?.[0]?.miss) check("меч, попадание: цель вспыхивает и отлетает", r.samples.some(q => q.flash) && r.samples.some(q => q.bmove > 5));
  }
  if (want("sword-miss")) {
    const r = await attack("sword-miss", "TC-тест: герой", "longsword", 40, { frames: 10 });
    check("меч, промах: цель уклоняется", r.samples.some(q => q.react), JSON.stringify(r.res));
    check("меч, промах: всё на месте после", settled(r));
  }
  const styleOf = r => r.samples.find(q => q.style)?.style;
  if (want("sword-sneak")) {
    const r = await attack("sword-sneak", "TC-тест: герой", "longsword", 1, { before: "hide" });
    check("меч, спрятался: исподтишка", styleOf(r) === "sneak", styleOf(r));
    check("меч, исподтишка: всё на месте после", settled(r));
  }
  if (want("sword-heavy")) {
    const r = await attack("sword-heavy", "TC-тест: герой", "longsword", 1, { config: { attackMode: "twoHanded" } });
    check("меч двумя руками: с замахом", styleOf(r) === "heavy", styleOf(r));
    check("меч, с замахом: всё на месте после", settled(r));
  }
  // Рапира и кинжал: каждый приём (стиль задан принудительно), попадание
  for (const [weapon, styles] of [["rapier", ["lunge", "sneak", "heavy", "leap"]], ["dagger", ["lunge", "sneak", "heavy"]], ["greataxe", ["lunge", "heavy", "sneak", "leap"]], ["unarmed-strike", ["lunge", "leap", "sneak", "heavy"]]]) {
    for (const st of styles) {
      const name = `${weapon === "unarmed-strike" ? "fist" : weapon}-${st}`;
      if (!want(name)) continue;
      const r = await attack(name, "TC-тест: герой", weapon, 1, { style: st });
      check(`${name}: приём выбран, оружие видно`, styleOf(r) === st && r.samples.some(q => q.rig), styleOf(r));
      if (st === "sneak" && weapon === "unarmed-strike") { check(`${name}: цель цепенеет`, r.samples.some(q => q.numb)); }
      check(`${name}: цель вспыхивает`, r.samples.some(q => q.flash));
      check(`${name}: всё на месте после`, settled(r));
    }
  }
  // Стрелковое и метательное
  for (const [name, weapon, st, config] of [
    ["bow-lunge", "longbow", "lunge"], ["bow-heavy", "longbow", "heavy"], ["bow-sneak", "longbow", "sneak"], ["bow-leap", "longbow", "leap"],
    ["xbow-lunge", "lightcrossbow", "lunge"], ["hxbow-heavy", "heavycrossbow", "heavy"], ["handxbow-leap", "handcrossbow", "leap"],
    ["musket-lunge", "musket", "lunge"], ["musket-leap", "musket", "leap"], ["pistol-heavy", "pistol", "heavy"], ["pistol-sneak", "pistol", "sneak"],
    ["javelin-thrown", "javelin", "lunge", { attackMode: "thrown" }], ["handaxe-thrown", "handaxe", "lunge", { attackMode: "thrown" }]
  ]) {
    if (!want(name)) continue;
    const r = await attack(name, "TC-тест: герой", weapon, 1, { style: st, config, frames: 20 });
    check(`${name}: оружие видно`, r.samples.some(q => q.rig), styleOf(r));
    check(`${name}: цель вспыхивает`, r.samples.some(q => q.flash));
    check(`${name}: всё на месте после`, settled(r));
  }
  if (want("bow-miss")) {
    // Уход задан явно: цель с оружием может и сбить стрелу, тогда она не сходит с места
    const r = await attack("bow-miss", "TC-тест: герой", "longbow", 40, { style: "lunge", frames: 20, dodge: "side" });
    check("лук, промах: цель уходит", r.samples.some(q => q.react));
    check("лук, промах: всё на месте после", settled(r));
  }
  if (want("bow-parry")) {
    const r = await attack("bow-parry", "TC-тест: герой", "longbow", 40, { style: "lunge", frames: 20, dodge: "parry" });
    check("лук, стрела сбита клинком: у цели оружие в руке", r.samples.some(q => q.brig));
    check("лук, стрела сбита клинком: всё на месте после", settled(r));
  }
  if (want("greataxe-miss")) {
    const r = await attack("greataxe-miss", "TC-тест: герой", "greataxe", 40, { style: "lunge" });
    check("секира, промах: цель уходит или парирует", r.samples.some(q => q.react));
    check("секира, промах: всё на месте после", settled(r));
  }
  if (want("rapier-miss")) {
    const r = await attack("rapier-miss", "TC-тест: герой", "rapier", 40, { style: "lunge" });
    check("рапира, промах: цель уходит или парирует", r.samples.some(q => q.react));
    check("рапира, промах: всё на месте после", settled(r));
  }
  // Природные атаки чудища (попадание и один промах)
  for (const kind of ["bite", "claw", "tentacle", "vine", "sting", "touch", "spit"]) {
    const name = `beast-${kind}`;
    if (!want(name)) continue;
    const r = await attack(name, "TC-тест: чудище", kind, 1, { frames: 18 });
    check(`${name}: атака идёт`, r.samples.some(q => q.act), JSON.stringify(r.res));
    check(`${name}: цель вспыхивает`, r.samples.some(q => q.flash));
    check(`${name}: всё на месте после`, settled(r));
  }
  if (want("beast-miss")) {
    const r = await attack("beast-miss", "TC-тест: чудище", "tentacle", 40, { frames: 18 });
    check("щупальце, промах: цель уходит", r.samples.some(q => q.react));
    check("щупальце, промах: всё на месте после", settled(r));
  }
  // Защита: парирование клинком и щитом (у бандита — скимитар; щит даётся на время)
  if (want("parry-blade")) {
    const r = await attack("parry-blade", "TC-тест: герой", "longsword", 40, { style: "lunge", dodge: "parry" });
    check("парирование клинком: у цели оружие в руке", r.samples.some(q => q.brig));
    check("парирование клинком: всё на месте после", settled(r));
  }
  for (const [name, weapon] of [["shield-sword", "longsword"], ["shield-bow", "longbow"], ["shield-slam", "slam"]]) {
    if (!want(name)) continue;
    await page.evaluate(async () => {
      const b = canvas.tokens.placeables.find(t => t.name === "TC-тест: бандит");
      if (!b.actor.items.some(i => i.system.type?.value === "shield"))
        await b.actor.createEmbeddedDocuments("Item", [{ name: "Щит", type: "equipment", system: { type: { value: "shield" }, equipped: true, armor: { value: 2 } } }]);
    });
    const who = weapon === "slam" ? "TC-тест: зомби" : "TC-тест: герой";
    const r = await attack(name, who, weapon, 40, { style: "lunge", dodge: "parry", frames: 18 });
    check(`${name}: щит виден`, r.samples.some(q => q.shield));
    check(`${name}: всё на месте после`, settled(r));
  }
  if (want("slam-hit")) {
    const r = await attack("slam-hit", "TC-тест: зомби", "slam", 1);
    check("удар телом: подход и возврат", r.samples.some(q => q.shift > 10) && settled(r), JSON.stringify(r.res));
    if (!r.res.targets?.[0]?.miss) check("удар телом, попадание: цель вспыхивает и отлетает", r.samples.some(q => q.flash) && r.samples.some(q => q.bmove > 5));
  }
  if (want("slam-miss")) {
    const r = await attack("slam-miss", "TC-тест: зомби", "slam", 40, { frames: 10 });
    check("удар телом, промах: цель уклоняется", r.samples.some(q => q.react), JSON.stringify(r.res));
  }
  // Последним: атакующий сдвигается к цели
  if (want("sword-leap")) {
    const r = await attack("sword-leap", "TC-тест: герой", "longsword", 1, { before: "move" });
    check("меч, подошёл к цели: наскок", styleOf(r) === "leap", styleOf(r));
    check("меч, наскок: всё на месте после", settled(r));
  }
  const errs = log.filter(l => /pageerror|token-choreography/.test(l));
  check("нет ошибок модуля на странице", !errs.length, errs.slice(0, 2).join(" | "));
} catch (err) {
  check("проверка дошла до конца", false, err.message);
  console.log(log.slice(-10).join("\n"));
} finally {
  const bad = summary();
  await close();
  process.exit(bad ? 1 : 0);
}
