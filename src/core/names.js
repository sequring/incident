export const norm = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

const stripParens = (s) => s.replace(/\(.*?\)/g, ' ');
// "Security Information and Event Management (SIEM) Log Analysis" → "siem", "siem log analysis"
const acronyms = (s) => [...s.matchAll(/\(([^)]+)\)([^(]*)/g)].flatMap((m) => [norm(m[1]), norm(`${m[1]} ${m[2]}`)]);
const tokens = (s) => new Set(norm(stripParens(s)).split(' ').filter((t) => t.length > 2 && !['and', 'the', 'for'].includes(t)));

// Resolves a procedure name as printed on an attack/inject card to a procedure card id.
export function makeResolver(procedures) {
  const exact = new Map();
  for (const p of procedures) {
    for (const key of [norm(p.name_en), norm(stripParens(p.name_en)), ...acronyms(p.name_en)]) {
      if (key && !exact.has(key)) exact.set(key, p.id);
    }
  }
  return (name) => {
    for (const key of [norm(name), norm(stripParens(name)), ...acronyms(name)]) {
      if (exact.has(key)) return exact.get(key);
    }
    const want = tokens(name);
    let best = null, bestScore = 0, tie = false;
    for (const p of procedures) {
      const have = tokens(p.name_en);
      const inter = [...want].filter((t) => have.has(t)).length;
      const score = inter / new Set([...want, ...have]).size;
      if (score > bestScore) { best = p.id; bestScore = score; tie = false; } else if (score === bestScore) tie = true;
    }
    return bestScore >= 0.5 && !tie ? best : null;
  };
}
