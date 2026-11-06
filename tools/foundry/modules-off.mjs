/**
 * Выключить в тестовом мире сторонние модули анимации токенов, чтобы не мешали снимкам:
 * Automated Animations, Sequencer, JB2A, Token Magic FX, Combat Booster (маркер хода под токеном).
 *
 *   node tools/foundry/modules-off.mjs
 */

import { connect } from "./harness.mjs";

const OFF = ["autoanimations", "sequencer", "JB2A_DnD5e", "tokenmagic", "combatbooster"];
const { page, close } = await connect();
try {
  const before = await page.evaluate(async off => {
    const cfg = foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration"));
    const was = Object.fromEntries(off.map(id => [id, !!cfg[id]]));
    for (const id of off) cfg[id] = false;
    await game.settings.set("core", "moduleConfiguration", cfg);
    return was;
  }, OFF);
  console.log("было включено:", JSON.stringify(before));
  await page.waitForTimeout(1000);
  await page.reload();
  await page.waitForFunction(() => window.game?.ready, null, { polling: 250, timeout: 120000 });
  const active = await page.evaluate(() => [...game.modules].filter(m => m.active).map(m => m.id));
  console.log("включены сейчас:", active.join(", "));
} finally {
  await close();
}
