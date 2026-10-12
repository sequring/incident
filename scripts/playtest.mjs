// Plays full games through the real UI and checks the board against the engine state after every turn.
// Usage: npm run dev (in another terminal), then: GAMES=2 [ONLY="Trimarc"] npm run playtest
import { chromium } from 'playwright-core';
const URL_ = process.env.BASE_URL ?? 'http://localhost:5173/';
const GAMES = Number(process.env.GAMES ?? 2);
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL_);
await page.waitForFunction(() => window.__game?.board);
await page.evaluate(() => window.__game.speed(5));
await page.waitForTimeout(800);
await page.mouse.click(720, 450);
await page.waitForSelector('.menu');
const decks = await page.locator('.decks button b').allInnerTexts();
const problems = [];
const summary = [];

async function clearModals() {
  for (let k = 0; k < 6; k++) {
    if (await page.locator('button:has-text("Принято")').count()) { await page.click('button:has-text("Принято")'); continue; }
    if (await page.locator('.consultants').count()) {
      const btns = page.locator('.consultant .btn');
      await btns.nth(Math.floor(Math.random() * await btns.count())).click();
      continue;
    }
    break;
  }
}

async function verify(tag) {
  let r = await snapshot();
  if (r.length) { await page.waitForTimeout(1500); r = await snapshot(); }
  for (const p of r) problems.push(`${tag}: ${p}`);
}

async function snapshot() {
  return page.evaluate(() => {
    const g = window.__game; const s = g.session.state; const b = g.board; const out = [];
    const slots = Object.keys(s.attacks);
    if (Object.keys(b.attackSlots).length !== slots.length) out.push(`slots on board ${Object.keys(b.attackSlots).length} != ${slots.length}`);
    for (const k of slots) {
      const e = b.attackSlots[k];
      if (!e) continue;
      const alpha = e.container.alpha * e.inner.alpha;
      if (!e.container.visible || alpha < 0.99) out.push(`${k} invisible (alpha ${alpha.toFixed(2)})`);
      if (s.revealed[k] && !e.face.visible) out.push(`${k} revealed but face hidden`);
      if (!s.revealed[k] && e.face.visible) out.push(`${k} hidden but face shown`);
      if (s.revealed[k] && e.face.texture.key !== `card-${s.attacks[k]}`) out.push(`${k} shows wrong card ${e.face.texture.key}`);
    }
    if (Object.keys(b.procCards).length !== s.table.length) out.push('procedure count mismatch');
    return out;
  });
}

for (const deck of (process.env.ONLY ? decks.filter((d) => d === process.env.ONLY) : decks)) {
  for (let n = 0; n < GAMES; n++) {
    if (!(await page.locator('.menu').count())) {
      await page.evaluate(() => window.__game.restart());
      await page.waitForSelector('.menu');
    }
    await page.click(`.decks button:has(b:text-is("${deck}"))`);
    await page.click('text=Начать расследование');
    await page.waitForSelector('.briefing');
    await page.click('text=Принять инцидент');
    await page.waitForFunction(() => !window.__game.busy, null, { timeout: 30000 });
    let turns = 0;
    while (turns < 40) {
      const st = await page.evaluate(() => window.__game.session.state.status);
      if (st !== 'playing') break;
      if (Math.random() < 0.15 && await page.locator('button:has-text("Подсказка"):not([disabled])').count()) await page.click('button:has-text("Подсказка")');
      const p = await page.evaluate(() => {
        const s = window.__game.session.state;
        const ok = s.table.filter((id) => {
          if (s.forced && s.forced.procId !== id) return false;
          if (s.forced?.procId === id) return true;
          if (s.removed[id] >= s.turn) return false;
          const last = s.lastUsed[id];
          return last === undefined || 3 - (s.turn - last - 1) <= 0;
        });
        return ok[Math.floor(Math.random() * ok.length)];
      });
      if (!p) { problems.push(`${deck}#${n}: nothing playable`); break; }
      await page.evaluate((x) => window.__game.play(x), p);
      for (let w = 0; w < 60; w++) {
        await clearModals();
        if (!(await page.evaluate(() => window.__game.busy))) break;
        await page.waitForTimeout(150);
      }
      await clearModals();
      await page.waitForTimeout(350);
      turns++;
      await verify(`${deck}#${n} t${turns}`);
    }
    const s = await page.evaluate(() => { const st = window.__game.session.state; return { status: st.status, found: Object.keys(st.revealed).length, slots: Object.keys(st.attacks).length, injects: st.injectsDrawn.length, consultants: st.consultants.length }; });
    await page.waitForSelector('.ending', { timeout: 15000 }).catch(() => problems.push(`${deck}#${n}: no end screen`));
    const endText = await page.locator('.ending .stat b').first().innerText().catch(() => '');
    if (endText && endText !== `${s.found}/${s.slots}`) problems.push(`${deck}#${n}: end screen says ${endText}, state ${s.found}/${s.slots}`);
    summary.push(`${deck.padEnd(26)} ${s.status.padEnd(8)} ${s.found}/${s.slots} ходов:${turns} вводных:${s.injects} консультантов:${s.consultants}`);
  }
}
console.log(summary.join('\n'));
console.log('\nPROBLEMS:', problems.length ? problems : 'none');
console.log('ERRORS:', errors.length ? [...new Set(errors)] : 'none');
await browser.close();
process.exit(problems.length || errors.length ? 1 : 0);
