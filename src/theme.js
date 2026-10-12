export const DISPLAY = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
export const MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

// Classic terminal palette: phosphor green on black, red for errors, amber for warnings.
export const HK = {
  bg: 0x020403,
  panel: 0x050a07,
  line: 0x14301f,
  green: 0x3be37f,
  bright: 0x9dffc4,
  dim: 0x2a8a52,
  text: 0xb6f5cc,
  amber: 0xe5b84a,
  red: 0xe5534b,
};

export const css = (n) => `#${n.toString(16).padStart(6, '0')}`;

const HEX = '0123456789abcdef';
export const hexLine = (bytes = 8) => Array.from({ length: bytes }, () => HEX[Math.floor(Math.random() * 16)] + HEX[Math.floor(Math.random() * 16)]).join(' ');
