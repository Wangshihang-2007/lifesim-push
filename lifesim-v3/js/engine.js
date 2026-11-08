/* =========================================================
 * 人生模拟器 v3 · 规则引擎（纯逻辑，不碰 DOM）
 * ---------------------------------------------------------
 * 时间轴：0 岁出生 → 死亡（自然 / 疾病 / 意外）
 * 每年：属性漂移 → 叛逆子系统 → 人生节点（大事件）或随机事件 → 死亡判定
 * ========================================================= */
(function (root) {
  'use strict';

  var D = root.LifeData;
  var MAX_AGE = D.MAX_AGE;

  var SCHOOL_END = 18;
  var REBEL_FROM = 10;
  var REBEL_TO = 18;
  var REBEL_FADE_TO = 25;

  /* ---------- 工具 ---------- */
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function rand() { return Math.random(); }

  function sumAttrs(attrs) {
    var s = 0;
    D.ATTR_KEYS.forEach(function (k) { s += attrs[k] || 0; });
    return s;
  }

  function weightedPick(list) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += (list[i].weight || 1);
    var r = rand() * total;
    for (i = 0; i < list.length; i++) {
      r -= (list[i].weight || 1);
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  /* ---------- A：开局 ---------- */

  var POINT_KEYS = ['health', 'academic', 'emotion', 'family', 'social', 'wealth'];

  function rollAttrs() {
    var attrs = {};
    // 随机起点仍从 1 开始，避免一开局就有 0；手动可以减到 0
    POINT_KEYS.forEach(function (k) { attrs[k] = 1; });
    var left = D.START_POINTS - POINT_KEYS.length;
    var guard = 500;
    while (left > 0 && guard-- > 0) {
      var avail = POINT_KEYS.filter(function (k) { return attrs[k] < D.ATTR_MAX; });
      if (!avail.length) break;
      attrs[avail[Math.floor(rand() * avail.length)]] += 1;
      left -= 1;
    }
    return attrs;
  }

  function rollTalents(n) {
    var pool = D.TALENTS.slice();
    var out = [];
    var rarities = Object.keys(D.TALENT_WEIGHT);
    while (out.length < (n || 3) && pool.length) {
      var total = 0;
      for (var i = 0; i < rarities.length; i++) {
        if (pool.some(function (t) { return t.rarity === rarities[i]; })) total += D.TALENT_WEIGHT[rarities[i]];
      }
      var x = rand() * total;
      var chosen = null;
      for (var j = 0; j < rarities.length; j++) {
        var r = rarities[j];
        if (!pool.some(function (t) { return t.rarity === r; })) continue;
        x -= D.TALENT_WEIGHT[r];
        if (x <= 0) { chosen = r; break; }
      }
      if (!chosen) chosen = pool[pool.length - 1].rarity;
      var group = pool.filter(function (t) { return t.rarity === chosen; });
      var pick = group[Math.floor(rand() * group.length)];
      pool.splice(pool.indexOf(pick), 1);
      out.push(pick);
    }
    return out;
  }

  function adjustAttr(attrs, key, delta) {
    var v = attrs[key];
    var total = 0;
    POINT_KEYS.forEach(function (k) { total += attrs[k]; });
    if (delta > 0) {
      if (total >= D.START_POINTS || v >= D.ATTR_MAX) return false;
    } else if (v <= D.ATTR_MIN) return false;
    attrs[key] = clamp(v + delta, D.ATTR_MIN, D.ATTR_MAX);
    return true;
  }

  function pointTotal(attrs) {
    var s = 0;
    POINT_KEYS.forEach(function (k) { s += attrs[k]; });
    return s;
  }

  function createLife(opts) {
    var attrs = {};
    POINT_KEYS.forEach(function (k) {
      attrs[k] = 20 + clamp(opts.attrs[k], D.ATTR_MIN, D.ATTR_MAX) * 9;
    });
    // 健康单独换算：先天体质 60—95，避免儿童期被「疾病」误杀
    attrs.health = 55 + clamp(opts.attrs.health, D.ATTR_MIN, D.ATTR_MAX) * 5;
    attrs.rebel = 8;
    attrs.career = 5;
    attrs.autonomy = 35;
    attrs.luck = 25 + Math.round(rand() * 45);

    var gender = opts.gender === 'female' ? 'female' : 'male';

    var talent = null;
    for (var i = 0; i < D.TALENTS.length; i++) {
      if (D.TALENTS[i].id === opts.talentId) { talent = D.TALENTS[i]; break; }
    }
    var region = null;
    for (var j = 0; j < D.REGIONS.length; j++) {
      if (D.REGIONS[j].id === opts.regionId) { region = D.REGIONS[j]; break; }
    }

    var state = {
      v: 3,
      version: D.VERSION,
      age: 0,
      attrs: attrs,
      gender: gender,
      childAge: null,
      talentId: talent ? talent.id : null,
      talentName: talent ? talent.name : '',
      regionId: region ? region.id : 'town',
      regionName: region ? region.name : '',
      tags: [],
      flags: {},
      used: {},
      seen: {},
      seenAt: {},
      pending: null,
      education: '未入学',
      careerTrack: '',
      marriage: '未婚',
      children: 0,
      housing: '无',
      city: '',
      retired: false,
      path: [],
      hSum: 0,
      hCount: 0,
      alive: true,
      death: null,
      ending: null
    };

    if (talent) applyEff(state, talent.eff);
    if (region) {
      applyEff(state, region.eff);
      region.tags.forEach(function (t) { if (state.tags.indexOf(t) < 0) state.tags.push(t); });
    }

    state.path.push({
      age: 0, title: '出生', text: birthText(state),
      major: true, kind: 'birth'
    });
    return state;
  }

  function birthText(state) {
    if (state.regionName === '村小') return '你出生在一个离县城四十公里的村子，屋后是山，屋前是田。';
    if (state.regionName === '县中') return '你出生在县城的单元楼里，楼下是菜市场，窗外是广场舞。';
    return '你出生在镇上，家里开着一间小卖部，柜台后面永远有一台嗡嗡响的冰柜。';
  }

  /* ---------- 状态 ---------- */

  function applyEff(state, eff) {
    var delta = {};
    if (!eff) return delta;

    D.ATTR_KEYS.forEach(function (k) {
      if (isNum(eff[k]) && eff[k] !== 0) {
        var before = state.attrs[k] || 0;
        var after = clamp(before + eff[k], 0, D.ATTR_CAP);
        state.attrs[k] = after;
        if (after !== before) delta[k] = after - before;
      }
    });

    if (eff.tags) eff.tags.forEach(function (t) { if (state.tags.indexOf(t) < 0) state.tags.push(t); });
    if (eff.flags) Object.keys(eff.flags).forEach(function (k) { state.flags[k] = eff.flags[k]; });
    if (eff.education) state.education = eff.education;
    if (eff.careerTrack) state.careerTrack = eff.careerTrack;
    if (eff.marriage) state.marriage = eff.marriage;
    if (eff.housing) state.housing = eff.housing;
    if (eff.retired !== undefined) state.retired = eff.retired;
    if (eff.children !== undefined && eff.children !== null) {
      state.children = Math.max(state.children, eff.children);
      if (state.children > 0 && !state.childAge) state.childAge = state.age;
    }
    if (eff.city) state.city = eff.city;

    return delta;
  }

  function phaseOf(state) {
    var a = state.age;
    if (a <= 6) return 'preschool';
    if (a <= 12) return 'primary';
    if (a <= 15) return 'middle';
    if (a <= 18) {
      if (state.education === '中职') return 'vocational';
      if (state.education === '普高') return 'senior';
      return 'social';
    }
    if (a <= 22) {
      if (['本科', '专科', '研究生'].indexOf(state.education) >= 0) return 'college';
      return 'work';
    }
    if (a <= 29) return 'work';
    if (a <= 35) return 'settle';
    if (a <= 54) return 'plateau';
    if (a <= 63) return 'retire';
    if (a <= 79) return 'late';
    return 'oldest';
  }

  function phaseName(state) {
    var id = phaseOf(state);
    for (var i = 0; i < D.PHASES.length; i++) {
      if (D.PHASES[i].id === id) return D.PHASES[i].name;
    }
    return '';
  }

  /* ---------- 每年漂移：学业 / 工作 / 健康 / 叛逆 ---------- */

  function isStudent(state) {
    return state.age >= 7 && state.age <= 22 &&
      ['小学', '初中', '普高', '中职', '本科', '专科', '研究生', '未入学'].indexOf(state.education) >= 0;
  }

  function genderDef(state) {
    var list = D.GENDERS || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === state.gender) return list[i];
    }
    return { id: 'male', lifeFactor: 1, disability: 4.2, motherPenalty: false };
  }

  function yearlyDrift(state) {
    var a = state.age;
    var at = state.attrs;
    var g = genderDef(state);

    /* 学业：在校期间随家庭支持增长，被高叛逆拖累 */
    if (isStudent(state) && state.education !== '未入学' && a <= 22) {
      var gain = 1.1 + (at.family - 50) / 80 - (at.rebel > 65 ? 1.2 : 0);
      at.academic = clamp(at.academic + gain, 0, D.ATTR_CAP);
    }

    /* 叛逆：10—18 岁累积，之后衰减 */
    if (a >= REBEL_FROM && a <= REBEL_TO) {
      var need = 2.2 + (a - REBEL_FROM) * 0.35;
      var support = at.family / 28;
      var pressure = (100 - at.academic) / 26;
      var peer = rand() * 2.2;
      var delta = (need - support) * 0.9 + pressure * 0.8 + peer;
      at.rebel = clamp(at.rebel + delta, 0, D.ATTR_CAP);
      /* 叛逆的双刃：家庭支持高 → 自主性涨；家庭支持低 → 情绪掉 */
      if (at.family >= 60) at.autonomy = clamp(at.autonomy + delta * 0.5, 0, D.ATTR_CAP);
      if (at.family < 40) at.emotion = clamp(at.emotion - delta * 0.6, 0, D.ATTR_CAP);
    } else if (a > REBEL_TO && a <= REBEL_FADE_TO) {
      at.rebel = clamp(at.rebel - 4, 0, D.ATTR_CAP);
    }

    /* 工作：职业资本与收入 */
    if (a >= 23 && !state.careerTrack && !state.retired) state.careerTrack = '打工';
    // 读完研的人 25 岁前后进入职场，别一直停在「学生」
    if (a >= 25 && state.careerTrack === '学生') {
      state.careerTrack = state.education === '研究生' ? '白领' : '打工';
    }
    if (a >= 19 && !state.retired && state.careerTrack && state.careerTrack !== '学生') {
      var cg = 0.7 + at.academic / 140;
      if (state.careerTrack === '体制') cg = 0.45;
      if (state.careerTrack === '灵活') cg = 0.35;

      // 母职惩罚：子女 0—6 岁，女性职业资本减速、收入下降；男性没有对称惩罚
      var childYears = (state.children > 0 && state.childAge) ? (a - state.childAge) : -1;
      var penalized = g.motherPenalty && childYears >= 0 && childYears <= 6;
      if (penalized) cg *= 0.4;

      at.career = clamp(at.career + cg, 0, D.ATTR_CAP);

      var income = 1.6 + at.career / 20;
      if (state.education === '本科' || state.education === '研究生') income += 0.6;
      if (state.careerTrack === '体制') income -= 0.3;
      if (state.careerTrack === '灵活') income -= 0.2;
      if (penalized) income -= 2.0;
      var cost = 1.3 + state.children * 0.5 + (state.housing === '一线房' ? 0.8 : 0);
      at.wealth = clamp(at.wealth + income - cost, 0, D.ATTR_CAP);
    }

    /* 健康：年龄越大衰减越快 */
    var decay = 0;
    if (a >= 45) decay += 0.15;
    if (a >= 60) decay += 0.35;
    if (a >= 75) decay += 0.8;
    if (at.rebel > 60 && a <= 25) decay += 0.3;
    if (decay) at.health = clamp(at.health - decay, 0, D.ATTR_CAP);

    if (a >= 18) { state.hSum += at.health; state.hCount += 1; }

    /* 情绪：家庭支持与健康托底，长期高压消耗 */
    if (at.family >= 60) at.emotion = clamp(at.emotion + 0.5, 0, D.ATTR_CAP);
    if (at.health < 35) at.emotion = clamp(at.emotion - 1, 0, D.ATTR_CAP);
  }

  /* ---------- 节点与事件 ---------- */

  function pickMajorNode(state) {
    for (var i = 0; i < D.MAJOR_NODES.length; i++) {
      var n = D.MAJOR_NODES[i];
      if (state.used[n.id]) continue;
      if (n.cond && !n.cond(state)) continue;
      var hit = (typeof n.age === 'number')
        ? (n.age === state.age)
        : (n.range && state.age >= n.range[0] && state.age <= n.range[1]);
      if (hit) return n;
    }
    return null;
  }

  /* 类别权重：23 岁前 D 恋爱 / C 友谊 / B 学业 / H 兴趣更密，
   * 23—59 岁 G 工作 / F 金钱为主，60 岁后 E 健康 / A 家庭为主。
   * 与 180 条事件库配套，配比由 test-events.js 的 800 局结果校准。 */
  var CAT_MUL = {
    young: { A: 0.3, B: 2.0, C: 2.2, D: 7.5, E: 0.2, F: 0.2, G: 0.08, H: 2.0, I: 0.25, J: 0.3 },
    adult: { A: 0.9, B: 0.2, C: 0.8, D: 0.6, E: 0.85, F: 1.8, G: 3.5, H: 0.8, I: 0.8, J: 0.85 },
    old:   { A: 3.2, B: 0.05, C: 0.8, D: 0.15, E: 2.4, F: 0.7, G: 0.2, H: 1.0, I: 0.8, J: 0.9 }
  };

  /* A—J 十类齐全，与 data.js 的 EVENTS.cat 一一对应 */
  var CAT_TITLE = { A: '家里', B: '学校', C: '朋友', D: '心动', E: '身体', F: '钱的事', G: '工作', H: '爱好', I: '意外', J: '世道' };

  function randFrom(arr) { return arr[Math.floor(rand() * arr.length)]; }

  function randName() { return randFrom(D.SURNAMES) + randFrom(D.GIVEN); }

  function catMul(cat, age) {
    var table = age < 23 ? CAT_MUL.young : (age < 60 ? CAT_MUL.adult : CAT_MUL.old);
    return table[cat] || 1;
  }

  /* 占位符：{name} {name2} {place} {item} {reason} {num}
   * 同一条文本里的同名占位符共用一次抽取（人名前后一致）；
   * {num} 恒为 1—9 的小数字；未知占位符兜底为空，避免把花括号显示给玩家。 */
  function fillTemplate(text, state) {
    var map = {
      name: randName(),
      name2: randName(),
      place: randFrom(D.PLACES),
      item: randFrom(D.ITEMS),
      reason: randFrom(D.REASONS),
      num: String(1 + Math.floor(rand() * 9))
    };
    return String(text == null ? '' : text).replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, function (m, key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : '';
    });
  }

  /* 事件筛选：年龄段 / cond(state) / once 一局一次 / cd 冷却年数
   * 未标注 cd 的事件默认一次性；标注 cd 的可重复出现，权重按已出现次数衰减。 */
  function eventAvailable(e, state, relaxCooldown) {
    if (!e || !e.age || state.age < e.age[0] || state.age > e.age[1]) return false;
    if (typeof e.cond === 'function' && !e.cond(state)) return false;
    if (!trackAllowsEvent(e, state)) return false;
    var seen = state.seen[e.id] || 0;
    if (seen > 0 && (e.once || !e.cd)) return false;
    if (!relaxCooldown && e.cd > 0 && state.seenAt[e.id] !== undefined &&
        state.age - state.seenAt[e.id] < e.cd) return false;
    return true;
  }

  /* 路径过滤：不在那条线上，就不该出现那条线的事件 */
  function trackAllowsEvent(e, state) {
    if (e.cat === 'G' && !state.careerTrack) return false;
    if (e.cat === 'B' && (state.education === '辍学' || state.age > 22)) return false;
    if (e.npc) {
      var who = e.npc.who || '';
      if (/老师|班主任/.test(who) && state.education === '辍学') return false;
      if (/经理|老板|领导/.test(who) && !state.careerTrack) return false;
    }
    if ((e.id === 'r_child' || e.id === 'r_grandchild') && !(state.children > 0)) return false;
    if (e.id === 'f_lend' && state.age < 18) return false;
    if (e.id === 'g_side' && !state.careerTrack) return false;
    return true;
  }

  function buildEventPool(state, relaxCooldown) {
    var pool = [];
    for (var i = 0; i < D.EVENTS.length; i++) {
      var e = D.EVENTS[i];
      if (!eventAvailable(e, state, relaxCooldown)) continue;
      var seen = state.seen[e.id] || 0;
      var w = (e.w || 1) * catMul(e.cat, state.age) * Math.pow(0.45, seen);
      if (w > 0) pool.push({ ev: e, w: w });
    }
    return pool;
  }

  function pickRandomEvent(state) {
    var pool = buildEventPool(state, false);
    /* 若所有候选都在冷却中，放宽冷却再抽一次：晚年不该出现成片空年 */
    if (!pool.length) pool = buildEventPool(state, true);
    if (!pool.length) return null;
    var total = 0;
    for (var j = 0; j < pool.length; j++) total += pool[j].w;
    var r = rand() * total;
    for (var k = 0; k < pool.length; k++) {
      r -= pool[k].w;
      if (r <= 0) return pool[k].ev;
    }
    return pool[pool.length - 1].ev;
  }

  function fillerText(state) {
    var a = state.age;
    if (a <= 6) return '这一年没什么特别的事，你只是又长高了一点。';
    if (a <= 12) return '这一年过得很快，你学会了自己收拾书包。';
    if (a <= 15) return '这一年很安静，你在题海里继续沉浮。';
    if (a <= 18) return '这一年重复得像前一天，你只记得窗外的天色。';
    if (a <= 22) return '这一年平平淡淡，你开始习惯用日历算日子。';
    if (a <= 40) return '这一年没什么大事，工资到账那天你给自己加了顿肉。';
    return '这一年很平常，你把院子里的花浇了又浇。';
  }

  /* ---------- 死亡 ---------- */

  function naturalRate(age) {
    var t = D.NATURAL_MORTALITY;
    if (age <= t[0][0]) return t[0][1];
    for (var i = 1; i < t.length; i++) {
      if (age <= t[i][0]) {
        var x0 = t[i - 1][0], y0 = t[i - 1][1];
        var x1 = t[i][0], y1 = t[i][1];
        return y0 + (y1 - y0) * (age - x0) / (x1 - x0);
      }
    }
    return t[t.length - 1][1];
  }

  function deathRates(state) {
    var a = state.age;
    var h = state.attrs.health;
    var g = genderDef(state);
    var nat = naturalRate(a) * (1.7 - h / 90) * (g.lifeFactor || 1);
    var dis = 0.0002 + Math.max(0, 40 - h) * 0.00025 + (a >= 55 ? (a - 55) * 0.00035 : 0);
    var acc = 0.001;
    if (a >= 12 && a <= 19) acc += (state.attrs.rebel / 100) * 0.003;
    if (a >= 70) acc += 0.001;
    if (state.careerTrack === '灵活') acc += 0.001;
    return {
      natural: clamp(nat, 0, 0.5),
      disease: clamp(dis, 0, 0.5),
      accident: clamp(acc, 0, 0.1)
    };
  }

  function rollDeath(state) {
    if (state.attrs.health <= 0) return { type: state.age >= 85 ? 'natural' : 'disease' };
    var r = deathRates(state);
    var total = r.natural + r.disease + r.accident;
    if (total >= 0.6) total = 0.6;
    var x = rand();
    if (x < r.accident) return { type: 'accident' };
    if (x < r.accident + r.disease) return { type: 'disease' };
    if (x < total) return { type: 'natural' };
    return null;
  }

  /* ---------- 判定 ---------- */

  function judgeRoll(state, check) {
    if (!check || !check.attr) return null;
    var base = state.attrs[check.attr];
    if (!isNum(base)) return null;
    var roll = base;
    (check.mods || []).forEach(function (m) {
      if (m && isNum(state.attrs[m.attr])) roll += state.attrs[m.attr] * m.ratio;
    });
    // 性别是初始偏移量：只改这一次判定的难度，不取消选择空间
    if (check.gender && check.gender[state.gender]) roll += check.gender[state.gender];
    return {
      attr: check.attr,
      roll: Math.round(roll * 10) / 10,
      threshold: check.threshold,
      ok: roll >= check.threshold
    };
  }

  function judgeText(j) {
    if (!j) return '';
    return '判定 ' + (D.ATTR_NAME[j.attr] || j.attr) + ' ' + j.roll +
      (j.ok ? ' ≥ ' : ' < ') + j.threshold + ' · ' + (j.ok ? '成功' : '失败');
  }

  /* ---------- 推进一年 ---------- */

  function routeLabel(state) {
    if (state.careerTrack === '体制') return '体制内';
    if (state.careerTrack === '创业') return '自己做';
    if (state.education === '辍学') return '早入社会';
    if (state.education === '研究生') return '读研';
    if (state.education === '本科') return '本科线';
    if (state.education === '专科') return '专科线';
    if (state.education === '中职') return '中职线';
    if (state.education === '普高') return '普高线';
    if (state.careerTrack) return state.careerTrack;
    return '起点';
  }
  function step(state) {
    if (!state.alive) return { lines: [], done: true };
    if (state.pending) return { lines: [], pending: state.pending, blocked: true };

    var lines = [];
    state.age += 1;

    var prevPhase = phaseOf(state);
    yearlyDrift(state);
    var newPhase = phaseOf(state);

    if (newPhase !== prevPhase) {
      lines.push({ age: state.age, phaseCard: true, title: phaseName(state) });
    }

    /* 大事件优先 */
    var node = pickMajorNode(state);
    if (node) {
      state.used[node.id] = true;
      state.pending = node.id;
      var line = {
        age: state.age, title: node.title, text: node.intro,
        major: true, nodeId: node.id, delta: null
      };
      state.path.push(line);
      lines.push(line);
      return { lines: lines, pending: node.id, done: false };
    }

    /* 随机事件 */
    var ev = pickRandomEvent(state);
    if (ev) {
      var eff = typeof ev.eff === 'function' ? ev.eff(state) : ev.eff;
      var delta = applyEff(state, eff);
      state.seen[ev.id] = (state.seen[ev.id] || 0) + 1;
      state.seenAt[ev.id] = state.age;
      var tpl = ev.t[Math.floor(rand() * ev.t.length)];
      var l = {
        age: state.age,
        title: CAT_TITLE[ev.cat] || '这一年',
        text: fillTemplate(tpl, state),
        delta: delta,
        kind: 'event',
        cat: ev.cat,
        npc: ev.npc || null
      };
      state.path.push(l);
      lines.push(l);
    } else {
      var l2 = { age: state.age, title: '这一年', text: fillerText(state), delta: null, kind: 'event' };
      state.path.push(l2);
      lines.push(l2);
    }

    /* 死亡 */
    if (state.age >= MAX_AGE) {
      finish(state, { type: 'natural' });
      return { lines: lines, death: state.death, done: true };
    }
    var d = rollDeath(state);
    if (d) {
      finish(state, d);
      return { lines: lines, death: state.death, done: true };
    }

    return { lines: lines, done: false };
  }

  /* ---------- 选择 ---------- */

  /* 分支解释：把判定拆成人话，告诉玩家「为什么是这个结果」 */
  function explainJudge(state, check, judge) {
    if (!judge || !check) return '';
    var parts = [D.ATTR_NAME[check.attr] + ' ' + Math.round(state.attrs[check.attr])];
    (check.mods || []).forEach(function (m) {
      if (m && isNum(state.attrs[m.attr])) {
        parts.push(D.ATTR_NAME[m.attr] + '×' + m.ratio + '（' + Math.round(state.attrs[m.attr] * m.ratio) + '）');
      }
    });
    if (check.gender && check.gender[state.gender]) {
      parts.push('性别 ' + (check.gender[state.gender] > 0 ? '+' : '') + check.gender[state.gender]);
    }
    return '为什么：' + parts.join(' + ') + ' = ' + judge.roll +
      (judge.ok ? '，过线 ' + judge.threshold : '，差 ' + (judge.threshold - judge.roll).toFixed(1));
  }

  function resolveChoice(state, choice, nodeId) {
    var judge = choice.check ? judgeRoll(state, choice.check) : null;
    var ok = judge ? judge.ok : true;
    var branch = ok ? choice.success : choice.fail;
    if (!branch) return { error: '选项数据缺失' };
    // 兼容两种写法：效果写在 success/fail 里，或写在选项顶层 eff
    var rawEff = branch.eff !== undefined ? branch.eff : choice.eff;
    var eff = typeof rawEff === 'function' ? rawEff(state) : rawEff;
    var text = typeof branch.text === 'function' ? branch.text(state) : branch.text;
    var explain = explainJudge(state, choice.check, judge);
    var delta = applyEff(state, eff);
    var line = {
      age: state.age, title: choice.label, text: text,
      delta: delta, judge: judge, explain: explain, check: choice.check || null,
      major: true, nodeId: nodeId || null,
      action: choice.action || null
    };
    state.path.push(line);
    return { line: line };
  }

  function chooseMajor(state, optionId) {
    if (!state.pending) return { error: '当前没有待处理的人生节点' };
    var node = null;
    for (var i = 0; i < D.MAJOR_NODES.length; i++) {
      if (D.MAJOR_NODES[i].id === state.pending) { node = D.MAJOR_NODES[i]; break; }
    }
    if (!node) return { error: '节点不存在' };

    var opt = null;
    for (var j = 0; j < node.options.length; j++) {
      if (node.options[j].id === optionId) { opt = node.options[j]; break; }
    }
    if (!opt) return { error: '选项不存在' };

    var res = resolveChoice(state, opt, node.id);
    if (res.error) return res;
    state.pending = null;
    return finishYear(state, res.line);
  }

  function finishYear(state, line) {
    var d = null;
    if (state.age >= MAX_AGE) d = { type: 'natural' };
    else d = rollDeath(state);
    if (d) {
      finish(state, d);
      return { lines: [line], death: state.death, done: true };
    }
    return { lines: [line], done: false };
  }

  /* ---------- 结局 ---------- */

  function dims(state) {
    var a = state.attrs;
    var married = state.marriage === '已婚';
    var kids = state.children > 0;
    var intimacy = clamp(a.social * 0.6 + (married ? 18 : 0) + (kids ? 10 : 0), 0, 100);
    var avgH = state.hCount ? state.hSum / state.hCount : a.health;
    var late = clamp(avgH * 0.45 + a.wealth * 0.2 + a.family * 0.2 + (state.housing !== '无' ? 8 : 0)
      - (genderDef(state).disability - 4.2) * 1.2, 0, 100);
    var regret = clamp(100 - (a.autonomy * 0.45 + intimacy * 0.35 + (married ? 8 : 0)), 0, 100);
    return {
      wealth: Math.round(a.wealth),
      health: Math.round(state.hCount ? state.hSum / state.hCount : a.health),
      intimacy: Math.round(intimacy),
      autonomy: Math.round(a.autonomy),
      family: Math.round(a.family),
      late: Math.round(late),
      regret: Math.round(regret),
      overall: Math.round(clamp(
        a.wealth * 0.24 + avgH * 0.2 + intimacy * 0.16 + a.autonomy * 0.14 +
        a.family * 0.11 + late * 0.15 - regret * 0.05 + 6, 0, 100
      ))
    };
  }

  function finish(state, death) {
    state.alive = false;
    var d = dims(state);
    var ending = D.ENDINGS[0];
    for (var i = 0; i < D.ENDINGS.length; i++) {
      if (D.ENDINGS[i].match(state)) { ending = D.ENDINGS[i]; break; }
    }
    var type = D.DEATH_TYPES[death.type] || D.DEATH_TYPES.natural;

    state.death = {
      type: death.type,
      name: type.name,
      age: state.age,
      gender: state.gender,
      dims: d,
      title: ending.title,
      grade: gradeOf(d.overall),
      obit: obitText(state, death, d)
    };
    state.ending = state.death;
    return state.death;
  }

  function gradeOf(score) {
    if (score >= 80) return 'S';
    if (score >= 68) return 'A';
    if (score >= 55) return 'B';
    if (score >= 42) return 'C';
    return 'D';
  }

  function obitText(state, death, d) {
    var head = '';
    if (death.type === 'accident') {
      head = state.age + ' 岁那年，一场意外把一切都按下了暂停。';
    } else if (death.type === 'disease') {
      head = state.age + ' 岁那年，病把身体一点点耗尽了。';
    } else if (state.age >= 85) {
      head = state.age + ' 岁，你在睡梦里安静地走了。';
    } else {
      head = state.age + ' 岁，身体在某个清晨不再配合你了。';
    }

    var bits = [];
    if (state.marriage === '已婚') bits.push('你成了家');
    if (state.children > 0) bits.push('有了孩子');
    if (state.housing !== '无') bits.push('有了自己的房子');
    if (state.careerTrack) bits.push('做过' + careerName(state.careerTrack));

    var tail = bits.length ? ('这一生，' + bits.join('，') + '。') : '这一生，你大多时候是一个人走的。';
    return head + tail;
  }

  function careerName(t) {
    var map = { '体制': '体制内的工作', '白领': '办公室的工作', '灵活': '灵活的工作',
      '创业': '自己的生意', '打工': '体力活', '学生': '学生', '技术': '技术岗', '管理': '管理工作' };
    return map[t] || t;
  }

  /* ---------- 导出 ---------- */
  root.LifeEngine = {
    MAX_AGE: MAX_AGE,
    rollAttrs: rollAttrs,
    rollTalents: rollTalents,
    adjustAttr: adjustAttr,
    pointTotal: pointTotal,
    sumAttrs: sumAttrs,
    createLife: createLife,
    step: step,
    chooseMajor: chooseMajor,
    judgeRoll: judgeRoll,
    judgeText: judgeText,
    phaseOf: phaseOf,
    phaseName: phaseName,
    deathRates: deathRates,
    resolveChoice: resolveChoice,
    routeLabel: routeLabel,
    finish: finish
  };
})(typeof window !== 'undefined' ? window : globalThis);
