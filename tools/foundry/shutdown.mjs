/** Закрыть тестовый мир (только testrogalika) — сервер возвращается к выбору миров */
import { connect, status, WORLD } from "./harness.mjs";
const st = await status();
if (!st.active) { console.log("Мир не запущен"); process.exit(0); }
if (st.world !== WORLD) { console.log(`Запущен «${st.world}» — не трогаю`); process.exit(1); }
const { page, browser } = await connect();
await page.evaluate(() => game.shutDown()).catch(() => {});
for (let i = 0; i < 60 && (await status()).active; i++) await new Promise(r => setTimeout(r, 1000));
console.log("Тестовый мир закрыт");
await browser.close();
