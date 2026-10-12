import Phaser from 'phaser';
import { W, H, ZOOM } from './BoardScene.js';
import { MONO, HK, css } from './theme.js';
import { TYPE_COLOR, TYPE_RU } from './core/narrator.js';

const BOOT = [
  ['SOC kernel 6.6.6-incident x86_64', null],
  ['Инициализация сенсоров EDR', 'ok'],
  ['Подключение к SIEM', 'ok'],
  ['Синхронизация журналов межсетевого экрана', 'ok'],
  ['Проверка целостности контроллеров домена', 'fail'],
  ['Обнаружена аномальная активность в 10.13.0.0/16', 'warn'],
  ['Неизвестный исходящий канал 185.220.101.4:443', 'warn'],
  ['Переход в режим реагирования на инцидент', 'active'],
];
const STATUS = {
  ok: ['[  OK  ]', HK.green],
  fail: ['[FAILED]', HK.red],
  warn: ['[ WARN ]', HK.amber],
  active: ['[ACTIVE]', HK.bright],
};
const RAIN = '0123456789abcdef';

const txt = (scene, x, y, s, style = {}) => scene.add.text(x, y, s, { fontFamily: MONO, fontSize: '13px', color: css(HK.text), resolution: ZOOM, ...style });

export class IntroScene extends Phaser.Scene {
  constructor() {
    super({ key: 'intro', active: true });
  }

  create() {
    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.centerOn(W / 2, H / 2);
    this.add.rectangle(W / 2, H / 2, W * 2, H * 2, HK.bg).setDepth(-10);

    this.makeRain();
    this.bootLog(() => {
      this.makeTitle();
      this.time.delayedCall(500, () => this.makeChain());
      this.time.delayedCall(1400, () => this.makePrompt());
    });
    txt(this, W / 2, H - 26, 'неофициальная русская адаптация Backdoors & Breaches · GPL-3.0', { fontSize: '11px', color: css(HK.dim) }).setOrigin(0.5);

    const scan = this.add.graphics().setDepth(50);
    scan.fillStyle(0x000000, 0.18);
    for (let y = 0; y < H; y += 3) scan.fillRect(0, y, W, 1);

    this.input.on('pointerdown', () => this.game.events.emit('intro-continue'));
    this.input.keyboard?.on('keydown', () => this.game.events.emit('intro-continue'));
    this.game.events.emit('intro-ready', this);
  }

  makeRain() {
    for (let i = 0; i < 22; i++) {
      const col = Array.from({ length: Phaser.Math.Between(8, 18) }, () => RAIN[Phaser.Math.Between(0, 15)]).join('\n');
      const t = txt(this, Phaser.Math.Between(0, W), Phaser.Math.Between(-400, H), col, { fontSize: '11px', color: css(HK.green), lineSpacing: -1 })
        .setAlpha(Phaser.Math.FloatBetween(0.04, 0.12)).setDepth(-5);
      this.tweens.add({ targets: t, y: H + 20, duration: Phaser.Math.Between(9000, 18000), repeat: -1, onRepeat: () => { t.x = Phaser.Math.Between(0, W); t.y = -300; } });
    }
  }

  bootLog(done) {
    const x = 48, y0 = 40, step = 19, dotsTo = 640;
    BOOT.forEach(([msg, st], i) => {
      this.time.delayedCall(140 + i * 150, () => {
        const ts = `[${(i * 0.1173).toFixed(6).padStart(12, ' ')}]`;
        const line = st ? `${ts} ${msg} ` : `${ts} ${msg}`;
        const t = txt(this, x, y0 + i * step, line, { color: css(st ? HK.text : HK.dim) });
        if (st) {
          const dots = '.'.repeat(Math.max(2, Math.floor((dotsTo - x - t.width) / 7.8)));
          t.setText(line + dots);
          const [label, color] = STATUS[st];
          txt(this, dotsTo + 8, y0 + i * step, label, { color: css(color), fontStyle: '700' });
        }
        if (i === BOOT.length - 1) this.time.delayedCall(250, done);
      });
    });
  }

  makeTitle() {
    const y = 270;
    const box = this.add.graphics();
    box.lineStyle(1, HK.green, 0.8).strokeRect(W / 2 - 300, y - 62, 600, 124);
    box.lineStyle(1, HK.green, 0.3).strokeRect(W / 2 - 294, y - 56, 588, 112);
    const title = txt(this, W / 2, y - 6, 'ИНЦИДЕНТ', { fontSize: '76px', fontStyle: '700', color: css(HK.green) }).setOrigin(0.5);
    const tag = txt(this, W / 2, y + 42, 'incident response simulator · v0.3', { fontSize: '11px', color: css(HK.dim) }).setOrigin(0.5);
    [box, title, tag].forEach((o) => o.setAlpha(0));
    this.tweens.add({ targets: [box, title, tag], alpha: { from: 0, to: 1 }, duration: 420, ease: 'Stepped', easeParams: [5] });
    this.time.addEvent({
      delay: 3200, loop: true, callback: () => {
        title.setAlpha(0.35);
        this.time.delayedCall(60, () => title.setAlpha(1));
      },
    });

    const lines = ['> периметр компании скомпрометирован', '> 10 ходов на восстановление цепочки атаки'];
    const out = lines.map((_, i) => txt(this, W / 2 - 290, 356 + i * 22, '', { fontSize: '14px', color: css(HK.text) }));
    let li = 0, ci = 0;
    this.time.addEvent({
      delay: 30, loop: true, callback: () => {
        if (li >= lines.length) return;
        ci++;
        out[li].setText(lines[li].slice(0, ci) + '█');
        if (ci >= lines[li].length) { out[li].setText(lines[li]); li++; ci = 0; }
      },
    });
  }

  makeChain() {
    const x = W / 2 - 290, y0 = 432;
    txt(this, x, y0, 'soc@incident:~$ ls ./attack_chain/', { color: css(HK.green) });
    ['initial', 'pivot', 'persist', 'c2'].forEach((t, i) => {
      this.time.delayedCall(120 + i * 140, () => {
        const y = y0 + 26 + i * 22;
        this.add.rectangle(x + 4, y + 8, 4, 14, Phaser.Display.Color.HexStringToColor(TYPE_COLOR[t]).color);
        const name = `0${i + 1}  ${TYPE_RU[t]} `;
        const label = txt(this, x + 16, y, name);
        txt(this, x + 16 + label.width, y, '.'.repeat(Math.max(2, Math.floor((560 - 16 - label.width - 70) / 7.8))), { color: css(HK.line) });
        txt(this, x + 580, y, '[ ??? ]', { color: css(HK.amber) }).setOrigin(1, 0);
      });
    });
  }

  makePrompt() {
    this.prompt = txt(this, W / 2 - 290, 600, 'soc@incident:~$ нажмите любую клавишу для подключения', { fontSize: '15px', color: css(HK.bright) });
    const cursor = txt(this, W / 2 - 290 + this.prompt.width + 4, 600, '█', { fontSize: '15px', color: css(HK.green) });
    this.tweens.add({ targets: cursor, alpha: 0, duration: 500, yoyo: true, repeat: -1, ease: 'Stepped', easeParams: [1] });
    this.cursor = cursor;
    if (this.promptHidden) this.setPromptVisible(false);
  }

  setPromptVisible(v) {
    this.promptHidden = !v;
    this.prompt?.setVisible(v);
    this.cursor?.setVisible(v);
  }
}
