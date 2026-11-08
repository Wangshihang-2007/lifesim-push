/* =========================================================
 * 事件库质量检查：数据规范 + 800 局模拟
 * 输出：平均每局事件数 / 唯一文本比 / undefined 数
 *       三个年龄段类别占比 / 空事件占比 / 每局事件数分布 / 验收判定
 * 运行：node test-events.js
 * ========================================================= */
require('./js/data.js');
require('./js/engine.js');

const D = globalThis.LifeData;
const E = globalThis.LifeEngine;

const RUNS = 800;
const EXPECT = { A: 22, B: 23, C: 20, D: 18, E: 22, F: 18, G: 26, H: 16, I: 14, J: 12 };
const CATS = Object.keys(EXPECT);
const TOKENS = ['{name}', '{name2}', '{place}', '{item}', '{reason}', '{num}'];
const bandOf = (age) => age < 23 ? 'young' : (age < 60 ? 'adult' : 'old');

/* ---------- 1. 事件库静态检查 ---------- */
const catCount = {};
const dataIssues = [];
const seenIds = new Set();

D.EVENTS.forEach((e) => {
  catCount[e.cat] = (catCount[e.cat] || 0) + 1;
  if (seenIds.has(e.id)) dataIssues.push('重复 id: ' + e.id);
  seenIds.add(e.id);
  if (CATS.indexOf(e.cat) < 0) dataIssues.push('未知类别: ' + e.id);
  if (!Array.isArray(e.age) || e.age.length !== 2 || e.age[0] > e.age[1]) dataIssues.push('年龄区间: ' + e.id);
  if (!Array.isArray(e.t) || e.t.length < 1 || e.t.length > 3) dataIssues.push('文本变体数不是 1—3: ' + e.id);
  if (!e.cond && !e.npc && !e.t.some(t => /\{(name|place|item|reason|num)\}/.test(t))) dataIssues.push('未使用占位符: ' + e.id);
  (e.t || []).forEach((t) => {
    (t.match(/\{[a-zA-Z0-9]+\}/g) || []).forEach((m) => {
      if (TOKENS.indexOf(m) < 0) dataIssues.push('未知占位符 ' + m + ' @ ' + e.id);
    });
  });
  if (!e.eff || typeof e.eff !== 'object') dataIssues.push('缺少 eff: ' + e.id);
  Object.keys(e.eff || {}).forEach((k) => {
    if (D.ATTR_KEYS.indexOf(k) < 0) dataIssues.push('非法属性 ' + k + ' @ ' + e.id);
    if (Math.abs(e.eff[k]) > 6) dataIssues.push('属性效果超过 6: ' + e.id + '.' + k);
  });
  if (e.once !== undefined && typeof e.once !== 'boolean') dataIssues.push('once 类型错误: ' + e.id);
  if (e.cd !== undefined && !(typeof e.cd === 'number' && e.cd > 0)) dataIssues.push('cd 类型错误: ' + e.id);
  if (e.cond !== undefined && typeof e.cond !== 'function') dataIssues.push('cond 类型错误: ' + e.id);
});
CATS.forEach((c) => {
  if (catCount[c] !== EXPECT[c]) dataIssues.push('类别 ' + c + ' 数量 ' + catCount[c] + '，应为 ' + EXPECT[c]);
});
if (D.EVENTS.length !== 191) dataIssues.push('事件总数 ' + D.EVENTS.length + '，应为 191（187 + 4 条 NPC 事件）');
if (D.MAJOR_NODES.length !== 15) dataIssues.push('人生节点数被改动: ' + D.MAJOR_NODES.length + '（14 + 性别分化的 2 个危机节点 - 原 1 个）');

/* ---------- 2. 800 局模拟 ---------- */
const cats = { young: {}, adult: {}, old: {} };
const emptyByBand = { young: 0, adult: 0, old: 0 };
const perLifeEvents = [];
const uniquePerLife = [];
const allTexts = new Set();
let totalEvents = 0;
let undefinedText = 0;
let untitledCatLines = 0;

for (let i = 0; i < RUNS; i++) {
  const s = E.createLife({ attrs: E.rollAttrs(), talentId: 't_brain', regionId: 'town' });
  let guard = 0;
  while (s.alive && guard++ < 250) {
    if (s.pending) {
      const n = D.MAJOR_NODES.find(x => x.id === s.pending);
      const o = n.options.find(x => !x.cond || x.cond(s));
      E.chooseMajor(s, o.id);
    } else {
      E.step(s);
    }
  }
  const evs = s.path.filter(x => x.kind === 'event');
  const texts = evs.map(x => x.text);
  uniquePerLife.push(new Set(texts).size / Math.max(1, texts.length));
  perLifeEvents.push(evs.length);
  totalEvents += evs.length;

  evs.forEach((line) => {
    const band = bandOf(line.age);
    const cat = line.cat || '?';
    cats[band][cat] = (cats[band][cat] || 0) + 1;
    if (!line.cat) emptyByBand[band] += 1;
    if (line.cat && (!line.title || line.title === '这一年')) untitledCatLines += 1;
    if (!line.text || line.text.indexOf('undefined') >= 0 || /\{[a-zA-Z0-9]+\}/.test(line.text)) undefinedText++;
    allTexts.add(line.text);
  });
}

const meanRatio = uniquePerLife.reduce((a, b) => a + b, 0) / uniquePerLife.length;
const avgEvents = totalEvents / RUNS;
const globalRatio = allTexts.size / totalEvents;
const bandTotal = {};
const share = (band, cat) => {
  const t = bandTotal[band];
  return t ? (cats[band][cat] || 0) / t : 0;
};
Object.keys(cats).forEach((b) => {
  bandTotal[b] = Object.values(cats[b]).reduce((a, v) => a + v, 0);
});
const youngDCHB = ['D', 'C', 'H', 'B'].reduce((a, c) => a + share('young', c), 0);
const sorted = perLifeEvents.slice().sort((a, b) => a - b);
const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
const inRange = perLifeEvents.filter(x => x >= 55 && x <= 80).length / RUNS;

/* ---------- 3. 输出 ---------- */
const pct = (v) => (v * 100).toFixed(1) + '%';
console.log('=== 数据层 ===');
console.log('事件总数:', D.EVENTS.length, '| 各类别:', CATS.map(c => c + ' ' + catCount[c]).join(' / '));
console.log('文本变体:', D.EVENTS.reduce((a, e) => a + e.t.length, 0),
  '| once:', D.EVENTS.filter(e => e.once).length,
  '| cd:', D.EVENTS.filter(e => e.cd).length,
  '| cond:', D.EVENTS.filter(e => typeof e.cond === 'function').length);
console.log('数据问题:', dataIssues.length ? dataIssues.join(' | ') : '无');

console.log('\n=== 800 局模拟 ===');
console.log('平均每局事件数:', avgEvents.toFixed(1));
console.log('唯一文本比（每局均值）:', meanRatio.toFixed(3), '| 全局唯一文本比:', globalRatio.toFixed(3));
console.log('undefined / 空文本 / 未填充占位符:', undefinedText);
console.log('带类别但标题缺失的行:', untitledCatLines);
console.log('每局事件数分布: min', sorted[0], '| p5', q(0.05), '| p25', q(0.25), '| 中位', q(0.5),
  '| p75', q(0.75), '| p95', q(0.95), '| max', sorted[sorted.length - 1],
  '| 落在 55—80 的局数占比', pct(inRange));

console.log('\n=== 三个年龄段类别占比（含空事件 ?）===');
for (const band of ['young', 'adult', 'old']) {
  const t = bandTotal[band];
  const parts = Object.entries(cats[band])
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => k + ' ' + (v / t * 100).toFixed(1) + '%');
  const label = band === 'young' ? '23 岁前' : (band === 'adult' ? '23—59 岁' : '60 岁后');
  console.log(label, '(', t, '条 ):', parts.join(' · '),
    '| 空事件', pct(emptyByBand[band] / t));
}
console.log('空事件占比（全局）:', pct((emptyByBand.young + emptyByBand.adult + emptyByBand.old) / totalEvents));
console.log('23 岁前 D+C+H+B 合计:', pct(youngDCHB));

/* ---------- 4. 验收 ---------- */
const checks = [
  ['undefined = 0', undefinedText === 0, String(undefinedText)],
  ['唯一文本比 ≥ 0.85', meanRatio >= 0.85, meanRatio.toFixed(3)],
  ['23 岁前 D ≥ 18%', share('young', 'D') >= 0.18, pct(share('young', 'D'))],
  ['23 岁前 D+C+H+B ≥ 55%', youngDCHB >= 0.55, pct(youngDCHB)],
  ['23—59 岁 G ≥ 35%', share('adult', 'G') >= 0.35, pct(share('adult', 'G'))],
  ['23—59 岁 F ≥ 12%', share('adult', 'F') >= 0.12, pct(share('adult', 'F'))],
  ['60 岁后 E ≥ 30%', share('old', 'E') >= 0.30, pct(share('old', 'E'))],
  ['60 岁后 A ≥ 20%', share('old', 'A') >= 0.20, pct(share('old', 'A'))],
  ['60 岁后空事件 ≤ 10%', emptyByBand.old / bandTotal.old <= 0.10, pct(emptyByBand.old / bandTotal.old)],
  ['平均每局事件数 55—80', avgEvents >= 55 && avgEvents <= 80, avgEvents.toFixed(1)],
  ['事件库 191 条 / 类别配比 / 15 节点', dataIssues.length === 0, dataIssues.length + ' 个问题'],
  ['CAT_TITLE 覆盖所有类别', untitledCatLines === 0, String(untitledCatLines)]
];
console.log('\n=== 验收 ===');
checks.forEach(([name, ok, value]) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  →  ' + value));
const allPass = checks.every(x => x[1]);
console.log('\n结论:', allPass ? '全部通过' : '存在未通过项');
process.exitCode = allPass ? 0 : 1;
