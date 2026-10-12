import Phaser from 'phaser';
import { procedureStatus, slotsOf } from './core/engine.js';
import { TYPE_RU, TYPE_COLOR } from './core/narrator.js';
import { MONO, HK, css, hexLine } from './theme.js';

export const W = 960;
export const H = 760;
export const ZOOM = Math.min(3, Math.max(2, Math.ceil((window.devicePixelRatio || 1) * 1.5)));
// Cards are built at base size and scaled per row.
const CARD = { w: 128, h: 177 };
const ATTACK = { w: 160, h: 221, maxGap: 186, left: 124, right: W - 124 };
const INJECT = { w: 100, h: 138, x: 62 };
const EST = { maxGap: 140, left: 130, right: W - 130 };
const OTHER = { bottom: H - 6, maxGap: 106 };
// Big tables (combined decks) shrink the top rows to give two rows of procedures room.
const LAYOUTS = {
  normal: { attackY: 148, attackScale: 1, midY: 388, estScale: 1, otherTop: 546 },
  compact: { attackY: 112, attackScale: 0.75, midY: 300, estScale: 0.8, otherTop: 438 },
};
const hex = (css) => Phaser.Display.Color.HexStringToColor(css).color;
const TEXT = { fontFamily: MONO, color: css(HK.text), resolution: ZOOM };
const SLOT_FILE = { initial: '01_initial_access', pivot: '02_privesc_lateral', persist: '03_persistence', c2: '04_c2_exfil' };


export class BoardScene extends Phaser.Scene {
  constructor() {
    super('board');
    this.attackSlots = {};
    this.procCards = {};
  }

  create() {
    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.centerOn(W / 2, H / 2);
    cam.setBackgroundColor(css(HK.bg));
    this.game.events.emit('board-ready', this);
  }

  // Loads card textures on demand; resolves once all requested ids are available.
  loadCards(cards) {
    const missing = cards.filter((c) => !this.textures.exists(`card-${c.id}`));
    if (!missing.length) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (missing.every((c) => this.textures.exists(`card-${c.id}`))) {
          this.load.off('complete', check);
          resolve();
        }
      };
      for (const c of missing) this.load.image(`card-${c.id}`, c.image);
      this.load.on('complete', check);
      if (!this.load.isLoading()) this.load.start();
    });
  }

  loadIds(ids) {
    return this.loadCards(ids.map((id) => this.session.byId[id]).filter(Boolean));
  }

  label(x, y, text, size = 11, color = css(HK.dim)) {
    return this.add.text(x, y, text, { ...TEXT, fontSize: `${size}px`, color }).setOrigin(0.5, 0);
  }

  async setup(session, onCard) {
    const s0 = session.state;
    this.session = session;
    await this.loadIds([...s0.table, ...Object.values(s0.attacks)]);
    if (this.session !== session) return;
    this.onCard = onCard;
    this.children.removeAll(true);
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.attackSlots = {};
    this.procCards = {};
    const s = session.state;
    const L = (this.L = LAYOUTS[s.table.length > 13 ? 'compact' : 'normal']);

    this.label(W / 2, L.attackY - (ATTACK.h * L.attackScale) / 2 - 24, 'soc@incident:~$ ls ./attack_chain/   # скрытые звенья атаки', 11, css(HK.green));
    this.makeInjectArea();
    this.label(W / 2, L.midY - (CARD.h * L.estScale) / 2 - 24, `$ ls ./procedures/established/   # +${s.options.establishedBonus} к броску`, 11, css(HK.green));
    this.label(W / 2, L.otherTop - 20, '$ ls ./procedures/other/   # без бонуса', 11, css(HK.green));
    for (const id of s.table) this.procCards[id] = this.makeProcCard(id);
    this.refresh();
  }

  place(container, x, y, scale) {
    container.setData('home', { x, y, scale });
    if (container.getData('zoomed')) return;
    this.tweens.killTweensOf(container);
    container.setPosition(x, y).setScale(scale).setDepth(0);
  }

  layoutAttacks() {
    const slots = slotsOf(this.session.state);
    for (const slot of slots) if (!this.attackSlots[slot]) this.attackSlots[slot] = this.makeAttackSlot(slot);
    const gap = Math.min(ATTACK.maxGap, (ATTACK.right - ATTACK.left) / slots.length);
    const scale = Math.min(this.L.attackScale, (gap * 0.88) / ATTACK.w);
    slots.forEach((slot, i) => {
      const x = W / 2 + (i - (slots.length - 1) / 2) * gap;
      const y = this.L.attackY - ((this.L.attackScale - scale) * ATTACK.h) / 2;
      this.place(this.attackSlots[slot].container, x, y, scale);
    });
  }

  layoutProcedures() {
    const s = this.session.state;
    const est = s.table.filter((id) => s.established.includes(id));
    const others = s.table.filter((id) => !s.established.includes(id));
    const estGap = Math.min(EST.maxGap, (EST.right - EST.left) / Math.max(1, est.length));
    const estScale = Math.min(this.L.estScale, (estGap * 0.9) / CARD.w);
    est.forEach((id, i) => this.place(this.procCards[id].container, W / 2 + (i - (est.length - 1) / 2) * estGap, this.L.midY, estScale));

    const rows = others.length > 9 ? 2 : 1;
    const perRow = Math.ceil(others.length / rows);
    const rowH = (OTHER.bottom - this.L.otherTop) / rows;
    const scaleByH = (rowH - 30) / CARD.h;
    const gap = Math.min(OTHER.maxGap, (W - 16) / perRow, (CARD.w * scaleByH) / 0.94);
    const scale = Math.min((gap * 0.94) / CARD.w, scaleByH);
    others.forEach((id, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, others.length - row * perRow);
      const col = i - row * perRow;
      const y = this.L.otherTop + row * rowH + (CARD.h * scale) / 2;
      this.place(this.procCards[id].container, W / 2 + (col - (inRow - 1) / 2) * gap, y, scale);
    });
    for (const id of s.table) this.procCards[id].established = s.established.includes(id);
  }

  makeInjectArea() {
    const { w, h: hgt } = INJECT;
    const y = this.L.midY;
    const pileX = INJECT.x, drawnX = W - INJECT.x;
    this.label(pileX, y - hgt / 2 - 22, 'injects/', 11, css(HK.amber));
    this.label(drawnX, y - hgt / 2 - 22, 'played/', 11, css(HK.dim));

    const back = this.add.graphics();
    for (let i = 2; i >= 0; i--) {
      back.fillStyle(HK.panel, 1).fillRect(-w / 2 + i * 3, -hgt / 2 - i * 3, w, hgt);
      back.lineStyle(1, HK.amber, i ? 0.3 : 0.75).strokeRect(-w / 2 + i * 3, -hgt / 2 - i * 3, w, hgt);
    }
    const mark = this.add.text(0, -14, '[!]', { ...TEXT, fontSize: '26px', fontStyle: '700', color: css(HK.amber) }).setOrigin(0.5);
    const count = this.add.text(0, 30, '', { ...TEXT, fontSize: '10px', color: css(HK.dim), align: 'center' }).setOrigin(0.5, 0);
    const pile = this.add.container(pileX, y, [back, mark, count]).setSize(w, hgt).setInteractive({ useHandCursor: true });
    pile.on('pointerdown', () => this.onCard('injects'));

    const empty = this.add.graphics();
    empty.lineStyle(1, HK.line, 1).strokeRect(-w / 2, -hgt / 2, w, hgt);
    const face = this.add.image(0, 0, '__DEFAULT').setDisplaySize(w, hgt).setVisible(false);
    const badge = this.add.text(w / 2 - 4, -hgt / 2 + 4, '', {
      ...TEXT, fontSize: '12px', fontStyle: '700', color: css(HK.bg), backgroundColor: css(HK.amber), padding: { x: 5, y: 2 },
    }).setOrigin(1, 0);
    const drawn = this.add.container(drawnX, y, [empty, face, badge]).setSize(w, hgt).setInteractive({ useHandCursor: true });
    drawn.setData('home', { x: drawnX, y, scale: 1 });
    drawn.on('pointerdown', () => this.onCard('injects'));
    this.hoverZoom(drawn, w, hgt, 1.8, () => face.visible);
    this.injectArea = { pile, count, drawn, face, badge, w, hgt };
  }

  refreshInjects() {
    const s = this.session.state;
    const a = this.injectArea;
    a.count.setText(`в колоде: ${s.injectDeck.length}`);
    const n = s.injectsDrawn.length;
    const last = s.injectsDrawn[n - 1];
    if (last && !this.textures.exists(`card-${last}`)) {
      this.loadIds([last]).then(() => this.refreshInjects());
      return;
    }
    a.face.setVisible(n > 0);
    if (n > 0) a.face.setTexture(`card-${last}`).setDisplaySize(a.w, a.hgt);
    a.badge.setText(`×${n}`).setVisible(n > 1);
  }

  animateInject(cardId, done) {
    if (!this.textures.exists(`card-${cardId}`)) {
      this.loadIds([cardId]).then(() => this.animateInject(cardId, done));
      return;
    }
    const a = this.injectArea;
    const card = this.add.image(a.pile.x, a.pile.y, 'card-' + cardId).setDisplaySize(a.w, a.hgt).setDepth(90);
    const baseScale = card.scaleX;
    card.scaleX = 0;
    this.tweens.chain({
      targets: card,
      tweens: [
        { scaleX: baseScale, duration: 200, ease: 'Quad.easeOut' },
        { x: W / 2, y: H / 2, scaleX: baseScale * 2.6, scaleY: baseScale * 2.6, duration: 420, ease: 'Cubic.easeOut' },
        { scaleX: baseScale * 2.6, duration: 650 },
        { x: a.drawn.x, y: a.drawn.y, scaleX: baseScale, scaleY: baseScale, duration: 380, ease: 'Cubic.easeIn' },
      ],
      onComplete: () => { card.destroy(); this.refreshInjects(); done(); },
    });
    this.cameras.main.shake(180, 0.004);
  }

  // Enlarges a card on hover (relative to its row size), keeping it inside the board.
  hoverZoom(container, w, hgt, zoom, enabled = () => true, caption = null) {
    const clamp = (v, half, max) => Math.min(Math.max(v, half + 4), max - half - 4);
    container.on('pointerover', () => {
      if (!enabled()) return;
      const home = container.getData('home');
      const scale = Math.max(home.scale * zoom, Math.min(1.5, zoom));
      container.setData('zoomed', true).setDepth(40);
      caption?.setVisible(false);
      this.tweens.killTweensOf(container);
      this.tweens.add({
        targets: container, scale, duration: 140, ease: 'Quad.easeOut',
        x: clamp(home.x, (w * scale) / 2, W),
        y: clamp(home.y, (hgt * scale) / 2, H - 4),
      });
    });
    const reset = () => {
      const home = container.getData('home');
      container.setData('zoomed', false);
      this.tweens.killTweensOf(container);
      this.tweens.add({
        targets: container, scale: home.scale, x: home.x, y: home.y, duration: 120,
        onComplete: () => { container.setDepth(0); caption?.setVisible(true); },
      });
    };
    container.on('pointerout', reset);
    container.on('pointerdown', reset);
  }

  makeAttackSlot(slot) {
    const type = this.session.state.slotType[slot];
    const { w, h: hgt } = ATTACK;
    const back = this.add.graphics();
    back.fillStyle(HK.panel, 1).fillRect(-w / 2, -hgt / 2, w, hgt);
    back.lineStyle(1, HK.green, 0.7).strokeRect(-w / 2, -hgt / 2, w, hgt);
    back.fillStyle(hex(TYPE_COLOR[type]), 0.9).fillRect(-w / 2, -hgt / 2, 4, hgt);
    const file = SLOT_FILE[slot] ?? `0${slotsOf(this.session.state).length}_${type}_extra`;
    const idx = this.add.text(-w / 2 + 12, -hgt / 2 + 8, `${file}.enc`, { ...TEXT, fontSize: '9px', color: css(HK.green) });
    const dump = this.add.text(-w / 2 + 12, -hgt / 2 + 26, Array.from({ length: 6 }, () => hexLine(5)).join('\n'), {
      ...TEXT, fontSize: '10px', color: css(HK.dim), lineSpacing: 2,
    });
    const lock = this.add.text(0, 30, '[ ЗАШИФРОВАНО ]', { ...TEXT, fontSize: '10px', color: css(HK.amber) }).setOrigin(0.5);
    const q = this.add.text(0, 14, '', { ...TEXT, fontSize: '1px' });
    const name = this.add.text(0, 48, TYPE_RU[type], { ...TEXT, fontSize: '11px', align: 'center', color: css(HK.text), wordWrap: { width: w - 20 } }).setOrigin(0.5, 0);
    this.time.addEvent({ delay: 900 + Math.random() * 600, loop: true, callback: () => dump.setText(Array.from({ length: 6 }, () => hexLine(5)).join('\n')) });
    const face = this.add.image(0, 0, '__DEFAULT').setDisplaySize(w, hgt).setVisible(false);
    // The flip animates this inner layer so re-layouts of the outer container can't interrupt it.
    const inner = this.add.container(0, 0, [back, idx, dump, lock, q, name, face]);
    const container = this.add.container(W / 2, this.L.attackY, [inner]).setSize(w, hgt).setInteractive({ useHandCursor: true });
    container.setData('home', { x: W / 2, y: this.L.attackY, scale: 1 });
    const s = () => this.session.state;
    container.on('pointerdown', () => this.onCard(s().revealed[slot] ? s().attacks[slot] : null));
    const entry = { container, inner, back, idx, dump, lock, q, name, face, shown: false };
    this.hoverZoom(container, w, hgt, 1.5, () => entry.shown);
    // Fade the inner layer: place() kills tweens on the outer container during relayout.
    if (slotsOf(s()).length > 4) {
      inner.setAlpha(0);
      this.tweens.add({ targets: inner, alpha: 1, duration: 500 });
    }
    return entry;
  }

  makeProcCard(id) {
    const { w, h: hgt } = CARD;
    const img = this.add.image(0, 0, `card-${id}`).setDisplaySize(w, hgt);
    const frame = this.add.graphics();
    const shade = this.add.rectangle(0, 0, w, hgt, HK.bg, 0.72).setVisible(false);
    const badge = this.add.text(0, -6, '', {
      ...TEXT, fontSize: '18px', fontStyle: '700', align: 'center', backgroundColor: css(HK.bg), padding: { x: 8, y: 4 },
    }).setOrigin(0.5);
    const name = this.add.text(0, hgt / 2 + 6, this.session.byId[id].name_ru, {
      ...TEXT, fontSize: '11px', align: 'center', color: css(HK.text), wordWrap: { width: w + 8 },
    }).setOrigin(0.5, 0);
    const container = this.add.container(W / 2, H / 2, [frame, img, shade, badge, name]).setSize(w, hgt).setInteractive({ useHandCursor: true });
    container.setData('home', { x: W / 2, y: H / 2, scale: 1 });
    this.hoverZoom(container, w, hgt, 1.6, () => true, name);
    container.on('pointerdown', () => this.onCard(id));
    return { container, img, frame, shade, badge, name, established: false };
  }

  refresh() {
    const s = this.session.state;
    this.layoutAttacks();
    this.layoutProcedures();
    const { w, h: hgt } = CARD;
    for (const [id, pc] of Object.entries(this.procCards)) {
      const st = procedureStatus(s, id);
      pc.frame.clear();
      pc.shade.setVisible(!st.ok && st.reason !== 'consultant');
      pc.badge.setText('');
      pc.name.setAlpha(st.ok ? 1 : 0.5);
      pc.badge.setVisible(false);
      if (st.reason === 'cooldown') pc.badge.setText(`[cd:${st.left}]`).setColor(css(HK.green)).setVisible(true);
      if (st.reason === 'removed') pc.badge.setText(st.left ? `[rm:${st.left}]` : '[rm]').setColor(css(HK.red)).setVisible(true);
      if (s.forced?.procId === id) {
        pc.frame.lineStyle(2, HK.amber, 1).strokeRect(-w / 2 - 6, -hgt / 2 - 6, w + 12, hgt + 12);
      } else if (pc.established) {
        pc.frame.lineStyle(2, HK.green, st.ok ? 0.85 : 0.3).strokeRect(-w / 2 - 5, -hgt / 2 - 5, w + 10, hgt + 10);
      }
    }
    for (const slot of slotsOf(s)) if (s.revealed[slot] && !this.attackSlots[slot].shown) this.flip(slot);
    this.refreshInjects();
  }

  flip(slot) {
    const entry = this.attackSlots[slot];
    entry.shown = true;
    const id = this.session.state.attacks[slot];
    if (!this.textures.exists(`card-${id}`)) {
      this.loadIds([id]).then(() => { entry.shown = false; this.flip(slot); });
      return;
    }
    const showFace = () => {
      [entry.back, entry.idx, entry.dump, entry.lock, entry.q, entry.name].forEach((o) => o.setVisible(false));
      entry.face.setTexture(`card-${this.session.state.attacks[slot]}`).setDisplaySize(ATTACK.w, ATTACK.h).setVisible(true);
    };
    this.tweens.add({
      targets: entry.inner, scaleX: 0, duration: 180, ease: 'Quad.easeIn',
      onComplete: () => {
        showFace();
        this.tweens.add({ targets: entry.inner, scaleX: 1, duration: 220, ease: 'Back.easeOut' });
        this.cameras.main.flash(120, 30, 120, 70, false);
      },
      onStop: () => { showFace(); entry.inner.setScale(1); },
    });
  }

  animateRoll(entry, done) {
    const rollEv = entry.events.find((e) => e.kind === 'roll');
    const name = this.session.byId[rollEv.procId].name_ru;
    const layer = this.add.container(0, 0).setDepth(100);
    const dim = this.add.rectangle(W / 2, H / 2, W, H, HK.bg, 0.9).setInteractive();
    const boxW = 560, boxH = 300, x0 = W / 2 - boxW / 2, y0 = H / 2 - boxH / 2;
    const frame = this.add.graphics();
    frame.fillStyle(HK.panel, 1).fillRect(x0, y0, boxW, boxH);
    frame.lineStyle(1, HK.green, 0.8).strokeRect(x0, y0, boxW, boxH);
    frame.fillStyle(HK.green, 0.85).fillRect(x0, y0, boxW, 20);
    const title = this.add.text(x0 + 10, y0 + 3, 'tty1 — roll.sh', { ...TEXT, fontSize: '11px', color: css(HK.bg), fontStyle: '700' });
    const lines = this.add.text(x0 + 18, y0 + 34, '', { ...TEXT, fontSize: '14px', color: css(HK.text), lineSpacing: 6, wordWrap: { width: boxW - 36 } });
    const big = this.add.text(W / 2, y0 + 168, '', { ...TEXT, fontSize: '56px', fontStyle: '700', color: css(HK.bright) }).setOrigin(0.5);
    const verdict = this.add.text(x0 + 18, y0 + boxH - 58, '', { ...TEXT, fontSize: '16px', fontStyle: '700', lineSpacing: 4 });
    layer.add([dim, frame, title, lines, big, verdict]);

    const head = [`soc@incident:~$ ./roll.sh --d20 --proc "${name}"`, '> инициализация процедуры...'];
    lines.setText(head.join('\n'));
    const spin = this.time.addEvent({ delay: 55, repeat: 12, callback: () => big.setText(String(1 + Math.floor(Math.random() * 20)).padStart(2, '0')) });
    this.time.delayedCall(780, () => {
      spin.remove();
      big.setText(String(entry.roll).padStart(2, '0'));
      const mod = entry.mod;
      const dice = rollEv.dice.length > 1 ? `  (2d20: ${rollEv.dice.join(', ')} → ${rollEv.mode === 'advantage' ? 'max' : 'min'})` : '';
      const reroll = entry.events.some((e) => e.kind === 'reroll') ? '  (переброс)' : '';
      const modTxt = mod ? ` ${mod > 0 ? '+' : '-'} ${Math.abs(mod)} = ${entry.total}` : '';
      lines.setText([...head, `> d20 = ${entry.roll}${modTxt}${dice}${reroll}   порог: 11`].join('\n'));
      const extra = entry.events.some((e) => e.kind === 'auto_success') ? ' (консультант)' : '';
      const inject = entry.events.some((e) => e.kind === 'inject');
      const nat = rollEv.roll === 20 ? '  natural 20' : rollEv.roll === 1 ? '  natural 1' : '';
      verdict.setText(`${entry.success ? '[  OK  ] процедура отработала' : '[FAILED] процедура не дала результата'}${extra}${nat}${inject ? '\n[ WARN ] получена вводная' : ''}`)
        .setColor(entry.success ? css(HK.green) : css(HK.red));
      if (rollEv.roll === 20 || rollEv.roll === 1) this.cameras.main.shake(160, 0.004);
    });
    this.time.delayedCall(2000, () => {
      this.tweens.add({ targets: layer, alpha: 0, duration: 200, onComplete: () => { layer.destroy(true); done(); } });
    });
  }
}
