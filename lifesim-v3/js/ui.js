/* =========================================================
 * 人生模拟器 v3 · 界面层
 * 屏幕：标题 / 出生 / 人生 / 死亡 / 设置
 * 人生节点卡：系统选项 + 「其他」自定义
 * ========================================================= */
(function () {
  'use strict';

  var D = window.LifeData;
  var E = window.LifeEngine;
  var S = window.LifeStorage;

  var $ = function (id) { return document.getElementById(id); };

  var settings = S.loadSettings();
  var game = null;
  var draft = null;
  var busy = false;
  var typingToken = 0;
  var lastAttrs = null;
  var returnScreen = 'title';
  var autoOn = false;
  var autoTimer = null;
  var undoHistory = [];   /* 每次节点选择前压入，可一路退回第一次选择 */

  var SPEED = { off: 0, fast: 10, normal: 20 };
  var DIM_LABEL = {
    wealth: '财富', health: '健康', intimacy: '亲密关系',
    autonomy: '自主', family: '家庭支持', late: '晚年质量', regret: '遗憾'
  };

  /* ---------- 通用 ---------- */
  function show(name) {
    ['title', 'setup', 'life', 'end', 'settings'].forEach(function (n) {
      var el = $('screen-' + n);
      if (el) el.classList.toggle('is-active', n === name);
    });
    if (name === 'life') {
      setTimeout(function () { var log = $('log'); if (log) log.scrollTop = log.scrollHeight; }, 30);
    }
  }

  function currentScreen() {
    var names = ['title', 'setup', 'life', 'end', 'settings'];
    for (var i = 0; i < names.length; i++) {
      if ($('screen-' + names[i]).classList.contains('is-active')) return names[i];
    }
    return 'title';
  }

  function toast(msg, ms) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('is-show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.classList.remove('is-show'); }, ms || 1800);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function speedMs() {
    if (settings.reduceMotion) return 0;
    return SPEED[settings.textSpeed] !== undefined ? SPEED[settings.textSpeed] : 20;
  }

  function typeText(el, text, ms) {
    return new Promise(function (resolve) {
      if (!ms || !text) { el.textContent = text; resolve(); return; }
      var token = ++typingToken;
      var i = 0;
      el.textContent = '';
      var timer = setInterval(function () {
        if (token !== typingToken) { clearInterval(timer); resolve(); return; }
        i += 1;
        el.textContent = text.slice(0, i);
        if (i >= text.length) { clearInterval(timer); resolve(); }
      }, ms);
    });
  }

  function applySettingsToBody() {
    document.body.classList.toggle('reduce-motion', !!settings.reduceMotion);
  }

  function saveNow() {
    if (!game || game.death) return;
    var ok = S.saveGame(game);
    var ind = $('save-ind');
    if (ind) {
      if (ok) {
        ind.textContent = '✓ 已存档';
        ind.classList.remove('is-error');
      } else {
        ind.textContent = '⚠ 存档失败';
        ind.classList.add('is-error');
      }
    }
  }

  /* ---------- 自动播放 / 回退上一个节点 ---------- */

  function setUndoState() {
    var b = $('btn-undo');
    if (b) b.disabled = !undoHistory.length || busy;
    var e = $('btn-undo-end');
    if (e) e.hidden = !undoHistory.length;
  }

  function clearAuto() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  }

  function updateAutoBtn() {
    var b = $('btn-auto');
    if (!b) return;
    b.textContent = autoOn ? '停止' : '自动';
    b.classList.toggle('is-on', autoOn);
    b.setAttribute('aria-pressed', autoOn ? 'true' : 'false');
  }

  function scheduleAuto(delay) {
    clearAuto();
    if (!autoOn || !game || game.death || game.pending || busy) return;
    autoTimer = setTimeout(function () {
      if (autoOn && !busy && game && !game.pending && !game.death) advance();
    }, delay || 900);
  }

  function toggleAuto() {
    autoOn = !autoOn;
    updateAutoBtn();
    if (autoOn) {
      toast('自动播放已开启，遇到人生节点会停下', 2200);
      scheduleAuto(400);
    } else {
      clearAuto();
      toast('自动播放已关闭');
    }
  }

  function restoreUndo() {
    if (!undoHistory.length) return;
    clearAuto();
    game = JSON.parse(undoHistory.pop());
    S.saveHistory(undoHistory);
    busy = false;
    S.saveGame(game);
    show('life');
    $('log').innerHTML = '';
    lastAttrs = null;
    renderHeader();
    chain(game.path, true).then(function () {
      if (game.pending) renderNodeCard();
      syncControls();
      setUndoState();
      scrollLog();
      toast('已回到上一次选择，可继续往回退', 2200);
    });
  }

  /* ---------- 标题 ---------- */
  function refreshTitle() {
    var save = S.loadGame();
    var btn = $('btn-continue');
    if (save && !save.death) {
      btn.disabled = false;
      btn.textContent = '继续上次（' + save.age + ' 岁 · ' + E.phaseName(save) + '）';
    } else {
      btn.disabled = true;
      btn.textContent = '继续上次';
    }
    var runs = S.getRuns();
    $('last-run').textContent = runs.length
      ? '最近一局：' + runs[0].cause + ' · ' + runs[0].age + ' 岁 · ' + runs[0].grade
      : '还没有走完一局';
  }

  /* ---------- 出生 ---------- */
  function newDraft() {
    return { attrs: E.rollAttrs(), talents: E.rollTalents(3), talentId: null, regionId: 'town', gender: 'male' };
  }

  function presetChips(eff) {
    var out = '';
    D.ATTR_KEYS.forEach(function (k) {
      if (typeof eff[k] === 'number' && eff[k] !== 0) {
        out += '<span class="chip ' + (eff[k] > 0 ? 'up' : 'down') + '">' +
          D.ATTR_NAME[k] + ' ' + (eff[k] > 0 ? '+' : '') + eff[k] + '</span>';
      }
    });
    return out;
  }

  function renderSetup() {
    var list = $('attr-list');
    list.innerHTML = '';
    D.ATTRS.slice(0, 6).forEach(function (a) {
      var row = document.createElement('div');
      row.className = 'attr-row';
      row.innerHTML =
        '<div>' +
          '<div class="attr-name"><span class="attr-dot" style="background:' + a.color + '"></span>' + a.name + '</div>' +
          '<div class="attr-desc">' + a.desc + '</div>' +
        '</div>' +
        '<div class="stepper">' +
          '<button data-act="minus" data-key="' + a.key + '" aria-label="减少' + a.name + '">−</button>' +
          '<span class="val" data-val="' + a.key + '">' + draft.attrs[a.key] + '</span>' +
          '<button data-act="plus" data-key="' + a.key + '" aria-label="增加' + a.name + '">+</button>' +
        '</div>';
      list.appendChild(row);
    });

    var tl = $('talent-list');
    tl.innerHTML = '';
    draft.talents.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'talent';
      b.dataset.id = t.id;
      b.dataset.rarity = t.rarity || 'common';
      var rarityLabel = (D.TALENT_RARITY_LABEL && D.TALENT_RARITY_LABEL[t.rarity]) || '普通';
      b.innerHTML = '<div class="t-top"><span class="t-name">' + t.name + '</span>' +
        '<span class="t-rarity">' + rarityLabel + '</span></div>' +
        '<div class="t-desc">' + t.desc + '</div>' +
        '<div class="t-eff">' + presetChips(t.eff) + '</div>';
      b.addEventListener('click', function () { draft.talentId = t.id; updateSetupState(); });
      tl.appendChild(b);
    });

    var rl = $('region-list');
    rl.innerHTML = '';
    D.REGIONS.forEach(function (r) {
      var b = document.createElement('button');
      b.className = 'region';
      b.dataset.id = r.id;
      b.innerHTML = '<div class="r-name">' + r.name + '</div>' +
        '<div class="r-desc">' + r.desc + '</div>' +
        '<div class="t-eff">' + presetChips(r.eff) + '</div>';
      b.addEventListener('click', function () { draft.regionId = r.id; updateSetupState(); });
      rl.appendChild(b);
    });

    var gl = $('gender-list');
    gl.innerHTML = '';
    D.GENDERS.forEach(function (g) {
      var b = document.createElement('button');
      b.className = 'region';
      b.dataset.id = g.id;
      b.innerHTML = '<div class="r-name">' + g.name + '</div>' +
        '<div class="r-desc">' + g.note + '</div>';
      b.addEventListener('click', function () { draft.gender = g.id; updateSetupState(); });
      gl.appendChild(b);
    });

    updateSetupState();
  }


  function updateSetupState() {
    var total = E.pointTotal(draft.attrs);
    var left = D.START_POINTS - total;
    $('points-left').textContent = '剩余 ' + left + ' 点';

    D.ATTR_KEYS.slice(0, 6).forEach(function (k) {
      var valEl = document.querySelector('[data-val="' + k + '"]');
      if (valEl) valEl.textContent = draft.attrs[k];
      var minus = document.querySelector('[data-act="minus"][data-key="' + k + '"]');
      var plus = document.querySelector('[data-act="plus"][data-key="' + k + '"]');
      if (minus) minus.disabled = draft.attrs[k] <= 0;
      if (plus) plus.disabled = draft.attrs[k] >= D.ATTR_MAX || total >= D.START_POINTS;
    });

    Array.prototype.forEach.call(document.querySelectorAll('.talent'), function (el) {
      el.classList.toggle('is-selected', el.dataset.id === draft.talentId);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.region'), function (el) {
      el.classList.toggle('is-selected', el.dataset.id === draft.regionId);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#gender-list .region'), function (el) {
      el.classList.toggle('is-selected', el.dataset.id === draft.gender);
    });

    $('derived-hint').textContent = '性别只改概率与代价：女性在生育与照护上代价更高，男性在婚配与职业竞争上压力更直接；路线仍由选择决定。';

    var rerollBtn = $('btn-talent-reroll');
    if (rerollBtn) {
      rerollBtn.textContent = '换一批';
      rerollBtn.disabled = false;
    }

    var ready = !!draft.talentId && !!draft.regionId && total <= D.START_POINTS;
    $('btn-create').disabled = !ready;
    $('btn-create').textContent = '出生';
  }

  function averageAttrs() {
    var keys = D.ATTR_KEYS.slice(0, 6);
    var base = Math.floor(D.START_POINTS / keys.length);
    var rest = D.START_POINTS - base * keys.length;
    keys.forEach(function (k, i) { draft.attrs[k] = base + (i < rest ? 1 : 0); });
    renderSetup();
  }

  /* ---------- 人生 ---------- */
  function renderHeader() {
    if (!game) return;
    $('age-num').textContent = game.age;
    $('stage-name').textContent = E.phaseName(game) + ' · ' + (game.gender === 'female' ? '女' : '男');

    var sceneEl = $('scene');
    if (sceneEl) {
      var ph = E.phaseOf(game);
      var scene = 'home';
      if (ph === 'primary' || ph === 'middle' || ph === 'senior' || ph === 'vocational' || ph === 'college') scene = 'school';
      else if (ph === 'work' || ph === 'settle' || ph === 'plateau') scene = 'office';
      sceneEl.setAttribute('data-scene', scene);
    }

    var strip = $('attrs-strip');
    strip.innerHTML = '';
    D.ATTRS.forEach(function (a) {
      var v = Math.round(game.attrs[a.key]);
      var item = document.createElement('div');
      item.className = 'attr-mini';
      item.innerHTML =
        '<div class="m-name">' + a.name + '</div>' +
        '<div class="m-val">' + v + '</div>' +
        '<div class="m-bar"><i style="width:' + Math.min(100, v) + '%;background:' + a.color + '"></i></div>';
      if (lastAttrs && lastAttrs[a.key] !== v) item.classList.add('flash');
      strip.appendChild(item);
    });

    var snap = {};
    D.ATTR_KEYS.forEach(function (k) { snap[k] = Math.round(game.attrs[k]); });
    lastAttrs = snap;

    syncControls();
  }

  function syncControls() {
    if (!game) return;
    var next = $('btn-next');
    if (game.death) {
      next.disabled = true;
      next.textContent = '人生已落幕';
      return;
    }
    next.disabled = busy || !!game.pending;
    next.textContent = game.pending ? '先完成当前选择' : (game.age >= 95 ? '走完最后几年' : '长大一岁');
    setUndoState();
  }

  function scrollLog() {
    var log = $('log');
    log.scrollTop = log.scrollHeight;
  }

  /* 场景占位图：按类别画一张极简 SVG，后续可替换为真实插画 */
  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function sceneArt(cat, age, title) {
    var m = D.CATEGORY_META && D.CATEGORY_META[cat];
    if (!m) return null;
    var box = document.createElement('div');
    box.className = 'art';
    box.style.setProperty('--c', m.color);

    /* 每类 3 张照片，按事件内容稳定挑选，避免同一条记录换图 */
    var idx = hashStr(cat + '|' + (age || 0) + '|' + (title || '')) % 3 + 1;
    var pos = ['50% 32%', '50% 55%', '60% 45%'][idx - 1];

    box.innerHTML =
      '<svg viewBox="0 0 320 120" preserveAspectRatio="none" aria-hidden="true">' +
        '<use href="#art-' + cat + '"></use>' +
      '</svg>' +
      '<img class="art-photo" alt="" src="assets/photos/' + cat + '-' + idx + '.jpg" ' +
        'style="object-position:' + pos + '" ' +
        'onerror="this.style.display=\'none\'">' +
      '<span class="art-label">' + m.icon + ' ' + m.label + '</span>';
    return box;
  }

  function makeEntry(line) {
    var wrap = document.createElement('div');
    wrap.className = 'entry' + (line.major ? ' is-major' : '');

    var art = sceneArt(line.cat, line.age, line.title);
    if (art) wrap.appendChild(art);

    var head = document.createElement('div');
    head.className = 'entry-head';
    var age = document.createElement('span');
    age.className = 'entry-age';
    age.textContent = line.age + ' 岁';
    var title = document.createElement('span');
    title.className = 'entry-title';
    title.textContent = line.title || '';
    head.appendChild(age);
    head.appendChild(title);
    wrap.appendChild(head);

    if (line.action) {
      var act = document.createElement('div');
      act.className = 'my-action';
      act.textContent = '我的选择：' + line.action;
      wrap.appendChild(act);
    }

    var p = document.createElement('p');
    p.className = 'entry-text';
    wrap.appendChild(p);

    if (line.npc && line.npc.lines) {
      var npc = document.createElement('div');
      npc.className = 'npc';
      var who = document.createElement('div');
      who.className = 'npc-name';
      who.textContent = line.npc.who;
      npc.appendChild(who);
      line.npc.lines.forEach(function (t) {
        var b = document.createElement('div');
        b.className = 'npc-bubble';
        b.textContent = t;
        npc.appendChild(b);
      });
      wrap.appendChild(npc);
    }

    if (line.judge) {
      var jRow = document.createElement('div');
      jRow.className = 'entry-judge';
      var chip = document.createElement('span');
      chip.className = 'chip judge';
      chip.textContent = E.judgeText(line.judge);
      jRow.appendChild(chip);
      wrap.appendChild(jRow);
    }

    if (line.explain) {
      var ex = document.createElement('div');
      ex.className = 'entry-explain';
      ex.textContent = line.explain;
      wrap.appendChild(ex);
    }

    if (line.delta) {
      var keys = D.ATTR_KEYS.filter(function (k) { return line.delta[k]; });
      if (keys.length) {
        var dl = document.createElement('div');
        dl.className = 'entry-delta';
        keys.forEach(function (k) {
          var v = line.delta[k];
          var chip2 = document.createElement('span');
          chip2.className = 'chip ' + (v > 0 ? 'up' : 'down');
          chip2.textContent = D.ATTR_NAME[k] + ' ' + (v > 0 ? '+' : '') + v;
          dl.appendChild(chip2);
        });
        wrap.appendChild(dl);
      }
    }

    return { wrap: wrap, text: p };
  }

  function renderLine(line, instant) {
    var log = $('log');
    if (line.phaseCard) {
      var card = document.createElement('div');
      card.className = 'stage-card';
      card.textContent = line.title;
      log.appendChild(card);
      scrollLog();
      return Promise.resolve();
    }
    var parts = makeEntry(line);
    log.appendChild(parts.wrap);
    scrollLog();
    return typeText(parts.text, line.text, instant ? 0 : speedMs()).then(scrollLog);
  }

  function chain(lines, instant) {
    var i = 0;
    function next() {
      if (i >= lines.length) return Promise.resolve();
      var line = lines[i++];
      return renderLine(line, instant).then(function () {
        return sleep(instant ? 0 : 140).then(next);
      });
    }
    return next();
  }

  function enterLife() {
    show('life');
    $('log').innerHTML = '';
    lastAttrs = null;
    renderHeader();
    $('btn-next').disabled = true;
    chain(game.path, true).then(function () {
      if (game.pending) renderNodeCard();
      syncControls();
      setUndoState();
      updateAutoBtn();
      scrollLog();
    });
  }

  /* ---------- 人生节点卡 ---------- */
  function removeNodeCard() {
    var c = $('node-card');
    if (c && c.parentNode) c.parentNode.removeChild(c);
  }

  function renderNodeCard() {
    removeNodeCard();
    if (!game || !game.pending) return;
    var node = null;
    for (var i = 0; i < D.MAJOR_NODES.length; i++) {
      if (D.MAJOR_NODES[i].id === game.pending) { node = D.MAJOR_NODES[i]; break; }
    }
    if (!node) return;

    var card = document.createElement('div');
    card.className = 'node-card';
    card.id = 'node-card';

    var t = document.createElement('div');
    t.className = 'node-title';
    t.textContent = '⚑ ' + node.title;
    card.appendChild(t);

    var sub = document.createElement('div');
    sub.className = 'node-sub';
    sub.textContent = '选一条路';
    card.appendChild(sub);

    node.options.forEach(function (opt) {
      if (opt.cond && !opt.cond(game)) return;
      var b = document.createElement('button');
      b.className = 'node-opt';
      b.innerHTML = '<div class="no-name">' + opt.label + '</div>' +
        (opt.desc ? '<div class="no-desc">' + opt.desc + '</div>' : '') +
        (opt.check ? '<div class="no-check">判定：' + D.ATTR_NAME[opt.check.attr] + ' ≥ ' + opt.check.threshold + '</div>' : '');
      b.addEventListener('click', function () { chooseOption(opt.id); });
      card.appendChild(b);
    });

    var log = $('log');
    log.appendChild(card);
    // 让节点卡从标题开始可见，而不是被滚到底部
    log.scrollTop = Math.max(0, card.offsetTop - 8);
  }

  function chooseOption(optionId) {
    if (busy || !game || !game.pending) return;
    undoHistory.push(JSON.stringify(game));
    if (undoHistory.length > 25) undoHistory = undoHistory.slice(-25);
    S.saveHistory(undoHistory);
    busy = true;
    syncControls();
    var res = E.chooseMajor(game, optionId);
    if (res.error) {
      toast(res.error);
      busy = false;
      syncControls();
      return;
    }
    removeNodeCard();
    renderHeader();
    chain(res.lines, false).then(function () {
      saveNow();
      if (res.death) { endFlow(res.death); return; }
      busy = false;
      syncControls();
      setUndoState();
      scheduleAuto();
    });
  }

  function advance() {
    if (busy || !game || game.death || game.pending) return;
    busy = true;
    syncControls();
    var res = E.step(game);
    renderHeader();
    chain(res.lines, false).then(function () {
      saveNow();
      if (res.death) { endFlow(res.death); return; }
      if (res.pending) renderNodeCard();
      busy = false;
      syncControls();
      scrollLog();
      scheduleAuto();
    });
  }

  /* ---------- 死亡 ---------- */
  /* ---------- 人生轨道 ---------- */
  var NODE_CAT = {
    n_school: 'B', n_puberty: 'C', n_phone: 'B', n_zhongkao: 'B', n_gaokao: 'B', n_graduate: 'B',
    n_marriage: 'D', n_child: 'A', n_crisis_f: 'G', n_house: 'F', n_crisis_m: 'G',
    n_plateau: 'G', n_empty: 'A', n_retire: 'G', n_late: 'E'
  };

  /* 克制的线条场景，只描边不填色 */
  var NODE_ART = {
    school: '<path d="M36 98H284"/><path d="M72 98V56H248V98"/><path d="M72 56L160 26L248 56"/>' +
      '<path d="M96 70h20v14H96zM132 70h20v14h-20zM168 70h20v14h-20zM204 70h20v14h-20z"/>' +
      '<path d="M160 26V10"/><path d="M160 12l18 5-18 5"/>',
    marriage: '<circle cx="138" cy="70" r="26"/><circle cx="182" cy="70" r="26"/>' +
      '<path d="M60 30v60M260 30v60" opacity=".35"/><path d="M138 44v52" opacity=".35"/>',
    home: '<path d="M80 100V60L160 30L240 60V100Z"/><path d="M146 74h28v26h-28z"/>' +
      '<circle cx="200" cy="70" r="9"/><path d="M40 100h240" opacity=".4"/>',
    work: '<path d="M56 86H264"/><path d="M120 86V52h80v34"/><path d="M132 66h56" opacity=".6"/>' +
      '<path d="M140 100v-14M180 100v-14"/><circle cx="236" cy="56" r="10"/><path d="M236 66v20"/>',
    house: '<path d="M70 100V58L160 24L250 58V100Z"/><path d="M110 100V74h34v26"/>' +
      '<path d="M196 74h22v26h-22z" opacity=".6"/><path d="M36 100h248" opacity=".4"/>',
    late: '<path d="M40 92H280"/><circle cx="160" cy="66" r="24"/>' +
      '<path d="M160 28v-12M118 46l-10-10M202 46l10-10" opacity=".7"/>',
    crisis: '<path d="M52 100V44h56v56"/><path d="M124 100V28h60v72"/><path d="M200 100V52h50v48"/>' +
      '<path d="M140 44h28M140 60h28" opacity=".5"/><path d="M32 100h264" opacity=".4"/>'
  };

  var ART_OF = {
    n_school: 'school', n_puberty: 'school', n_phone: 'school', n_zhongkao: 'school',
    n_gaokao: 'school', n_graduate: 'school',
    n_marriage: 'marriage', n_child: 'home', n_empty: 'home', n_house: 'house',
    n_crisis_f: 'work', n_crisis_m: 'work', n_plateau: 'work', n_retire: 'work',
    n_late: 'late'
  };

  function nodeArt(id, m) {
    var key = ART_OF[id] || 'crisis';
    var c = m ? m.color : '#f0c878';
    return '<svg class="tp-line" viewBox="0 0 320 120" style="color:' + c + '" aria-hidden="true">' +
      '<rect width="320" height="120" fill="#0e1420"/>' +
      '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".8">' +
      (NODE_ART[key] || '') + '</g></svg>';
  }

  function nodeTitle(id) {
    for (var i = 0; i < D.MAJOR_NODES.length; i++) if (D.MAJOR_NODES[i].id === id) return D.MAJOR_NODES[i].title;
    return '';
  }

  function renderTrajectory() {
    var svg = $('traj');
    var panel = $('traj-panel');
    if (!svg || !game) return;
    panel.innerHTML = '';
    panel.classList.remove('is-open');

    var W = 1000, H = 300, x0 = 56, x1 = 944, base = 168;
    var endAge = game.age || 80;
    var maxAge = Math.max(20, endAge);
    function xOf(a) { return x0 + Math.max(0, Math.min(maxAge, a)) / maxAge * (x1 - x0); }

    var majors = (game.path || []).filter(function (l) { return l.major && l.nodeId; });
    var pts = [{ age: 0, y: base }];
    majors.forEach(function (n, i) {
      pts.push({ age: n.age, y: base + (i % 2 ? 1 : -1) * (9 + (i % 3) * 5), node: n });
    });
    pts.push({ age: endAge, y: base + (majors.length % 2 ? -8 : 8) });

    var d = 'M' + xOf(pts[0].age).toFixed(1) + ' ' + pts[0].y;
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i - 1], q = pts[i];
      var xa = xOf(p.age), xb = xOf(q.age), mx = (xa + xb) / 2;
      d += ' C' + mx.toFixed(1) + ' ' + p.y + ' ' + mx.toFixed(1) + ' ' + q.y + ' ' + xb.toFixed(1) + ' ' + q.y;
    }

    var ns = 'http://www.w3.org/2000/svg';
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = '';

    var defs = document.createElementNS(ns, 'defs');
    defs.innerHTML =
      '<linearGradient id="trajGrad" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="#f0c878" stop-opacity=".2"/>' +
        '<stop offset=".5" stop-color="#f0c878" stop-opacity=".95"/>' +
        '<stop offset="1" stop-color="#f0c878" stop-opacity=".3"/>' +
      '</linearGradient>' +
      '<filter id="trajGlow" x="-20%" y="-60%" width="140%" height="220%">' +
        '<feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
      '</filter>';
    svg.appendChild(defs);

    var grid = document.createElementNS(ns, 'g');
    grid.setAttribute('opacity', '.1');
    [0.3, 0.6].forEach(function (r) {
      var ln = document.createElementNS(ns, 'line');
      ln.setAttribute('x1', 0); ln.setAttribute('x2', W);
      ln.setAttribute('y1', H * r); ln.setAttribute('y2', H * r);
      ln.setAttribute('stroke', '#8899aa'); ln.setAttribute('stroke-dasharray', '2 10');
      grid.appendChild(ln);
    });
    svg.appendChild(grid);

    /* 未走的路 */
    pts.forEach(function (p) {
      if (!p.node) return;
      var bx = xOf(p.node.age), by = p.y;
      var sign = by < base ? -1 : 1;
      var br = document.createElementNS(ns, 'path');
      br.setAttribute('d', 'M' + bx + ' ' + by + ' C' + (bx + 18) + ' ' + by + ' ' + (bx + 22) + ' ' + (by + sign * 22) + ' ' + (bx + 46) + ' ' + (by + sign * 22));
      br.setAttribute('fill', 'none');
      br.setAttribute('stroke', '#7f8b9c');
      br.setAttribute('stroke-width', '1');
      br.setAttribute('stroke-dasharray', '3 4');
      br.setAttribute('opacity', '.42');
      br.setAttribute('class', 'traj-branch');
      svg.appendChild(br);

      var end = document.createElementNS(ns, 'circle');
      end.setAttribute('cx', bx + 46); end.setAttribute('cy', by + sign * 22);
      end.setAttribute('r', 3); end.setAttribute('fill', 'none');
      end.setAttribute('stroke', '#7f8b9c'); end.setAttribute('opacity', '.5');
      end.setAttribute('class', 'traj-branch');
      svg.appendChild(end);
    });

    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'url(#trajGrad)');
    path.setAttribute('stroke-width', '2.2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('filter', 'url(#trajGlow)');
    path.setAttribute('class', 'traj-main');
    svg.appendChild(path);

    var start = document.createElementNS(ns, 'circle');
    start.setAttribute('cx', xOf(0)); start.setAttribute('cy', pts[0].y);
    start.setAttribute('r', 4); start.setAttribute('fill', '#f0c878');
    svg.appendChild(start);

    var endDot = document.createElementNS(ns, 'circle');
    endDot.setAttribute('cx', xOf(endAge)); endDot.setAttribute('cy', pts[pts.length - 1].y);
    endDot.setAttribute('r', 5); endDot.setAttribute('fill', '#f0c878'); endDot.setAttribute('opacity', '.9');
    svg.appendChild(endDot);

    var endLbl = document.createElementNS(ns, 'text');
    endLbl.setAttribute('x', xOf(endAge)); endLbl.setAttribute('y', H - 26);
    endLbl.setAttribute('text-anchor', 'middle');
    endLbl.setAttribute('fill', '#c9d1dc'); endLbl.setAttribute('font-size', '18');
    endLbl.textContent = endAge + ' 岁';
    svg.appendChild(endLbl);

    var groups = [];
    pts.forEach(function (p, i) {
      if (!p.node) return;
      var g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'traj-node');
      g.style.cursor = 'pointer';
      g.style.opacity = '0';

      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', xOf(p.node.age)); c.setAttribute('cy', p.y);
      c.setAttribute('r', 5.5); c.setAttribute('fill', '#141a26');
      c.setAttribute('stroke', '#f0c878'); c.setAttribute('stroke-width', '1.6');
      g.appendChild(c);

      if (i % 2 === 0) {
        var tx = document.createElementNS(ns, 'text');
        tx.setAttribute('x', xOf(p.node.age));
        tx.setAttribute('y', p.y + (p.y < base ? -16 : 28));
        tx.setAttribute('text-anchor', 'middle');
        tx.setAttribute('fill', '#9fb0c4'); tx.setAttribute('font-size', '17');
        tx.textContent = p.node.age;
        g.appendChild(tx);
      }

      g.addEventListener('click', function (ev) {
        ev.stopPropagation();
        showTrajPanel(p.node);
      });
      svg.appendChild(g);
      groups.push(g);
    });

    var hint = document.createElementNS(ns, 'text');
    hint.setAttribute('x', W / 2); hint.setAttribute('y', H - 6);
    hint.setAttribute('text-anchor', 'middle');
    hint.setAttribute('fill', '#7f8b9c'); hint.setAttribute('font-size', '15');
    hint.textContent = '点击轨道，让它从出生开始长出来';
    svg.appendChild(hint);

    var len = 1;
    try { len = path.getTotalLength(); } catch (e) { /* ignore */ }
    path.style.strokeDasharray = len;
    path.style.strokeDashoffset = len;

    [start, endDot, endLbl].forEach(function (el) { el.style.opacity = '0'; });

    var played = false;
    var DUR = 7500;                      /* 约 8 拍，64 BPM */

    function ripple(g) {
      var c = g.firstChild;
      var cx = Number(c.getAttribute('cx'));
      var cy = Number(c.getAttribute('cy'));
      var rp = document.createElementNS(ns, 'circle');
      rp.setAttribute('cx', cx); rp.setAttribute('cy', cy);
      rp.setAttribute('r', 6); rp.setAttribute('fill', 'none');
      rp.setAttribute('stroke', '#f0c878'); rp.setAttribute('stroke-width', '1');

      var a1 = document.createElementNS(ns, 'animate');
      a1.setAttribute('attributeName', 'r');
      a1.setAttribute('from', '6'); a1.setAttribute('to', '22');
      a1.setAttribute('dur', '0.9s'); a1.setAttribute('fill', 'freeze');
      var a2 = document.createElementNS(ns, 'animate');
      a2.setAttribute('attributeName', 'opacity');
      a2.setAttribute('from', '0.85'); a2.setAttribute('to', '0');
      a2.setAttribute('dur', '0.9s'); a2.setAttribute('fill', 'freeze');

      rp.appendChild(a1); rp.appendChild(a2);
      g.appendChild(rp);
      setTimeout(function () { if (rp.parentNode) rp.parentNode.removeChild(rp); }, 1000);
    }

    function play() {
      if (played) return;
      played = true;
      if (hint.parentNode) hint.parentNode.removeChild(hint);

      if (window.LifeAudio) {
        try { window.LifeAudio.start(); } catch (e) { /* 浏览器可能拦截自动播放 */ }
      }

      path.style.transition = 'stroke-dashoffset ' + (DUR / 1000) + 's cubic-bezier(.25,.6,.3,1)';
      path.style.strokeDashoffset = '0';

      start.style.transition = 'opacity .5s';
      start.style.opacity = '1';

      var n = Math.max(1, groups.length);
      groups.forEach(function (g, i) {
        var at = 320 + (DUR - 700) * (i / n);
        setTimeout(function () {
          g.style.transition = 'opacity .45s';
          g.style.opacity = '1';
          ripple(g);
        }, at);
      });

      setTimeout(function () {
        endDot.style.transition = 'opacity .8s';
        endDot.style.opacity = '1';
        endLbl.style.transition = 'opacity .8s';
        endLbl.style.opacity = '1';
      }, DUR - 400);
    }

    svg.style.cursor = 'pointer';
    svg.onclick = play;
  }

  function showTrajPanel(line) {
    var panel = $('traj-panel');
    if (!panel || !line) return;
    var cat = NODE_CAT[line.nodeId] || 'A';
    var m = D.CATEGORY_META && D.CATEGORY_META[cat];

    var chips = '';
    Object.keys(line.delta || {}).forEach(function (k) {
      var v = line.delta[k];
      if (!v) return;
      chips += '<span class="chip ' + (v > 0 ? 'up' : 'down') + '">' +
        (D.ATTR_NAME[k] || k) + ' ' + (v > 0 ? '+' : '') + v + '</span>';
    });

    panel.innerHTML =
      '<div class="tp-art" style="--c:' + (m ? m.color : '#f0c878') + '">' +
        nodeArt(line.nodeId, m) +
        '<span class="tp-tag">' + (m ? m.icon + ' ' + m.label : '人生节点') + '</span>' +
      '</div>' +
      '<div class="tp-body">' +
        '<div class="tp-age">' + line.age + ' 岁 · ' + nodeTitle(line.nodeId) + '</div>' +
        '<div class="tp-title">' + line.title + '</div>' +
        '<p class="tp-text">' + line.text + '</p>' +
        (chips ? '<div class="tp-chips">' + chips + '</div>' : '') +
      '</div>' +
      '<button class="tp-close" type="button">×</button>';

    panel.classList.add('is-open');
    panel.querySelector('.tp-close').addEventListener('click', function () {
      panel.classList.remove('is-open');
    });
  }

  function endFlow(death) {
    S.recordRun(death);
    S.clearSave();
    busy = false;
    autoOn = false;
    clearAuto();
    updateAutoBtn();
    setUndoState();
    setTimeout(function () { showEnd(death); renderTrajectory(); }, 700);
  }

  function showEnd(death) {
    $('death-kind').textContent = death.name;
    $('end-title').textContent = death.title;
    var diff = death.age - 79.25;
    var cmp = diff >= 0 ? '比平均寿命多 ' + diff.toFixed(1) + ' 年' : '比平均寿命少 ' + Math.abs(diff).toFixed(1) + ' 年';
    $('end-age').textContent = '享年 ' + death.age + ' 岁 · ' + cmp;
    $('end-score').textContent = death.dims.overall;
    $('end-grade').textContent = '综合 ' + death.grade;
    $('end-text').textContent = death.obit;

    var wrap = $('end-dims');
    wrap.innerHTML = '';
    ['wealth', 'health', 'intimacy', 'autonomy', 'family', 'late', 'regret'].forEach(function (k) {
      var v = death.dims[k];
      var row = document.createElement('div');
      row.className = 'dim-row';
      row.innerHTML = '<span class="dim-name">' + DIM_LABEL[k] + '</span>' +
        '<span class="dim-bar"><i style="width:' + Math.min(100, v) + '%"></i></span>' +
        '<span class="dim-val">' + v + '</span>';
      if (k === 'regret') row.classList.add('is-regret');
      wrap.appendChild(row);
    });

    var path = $('end-path');
    path.innerHTML = '';
    game.path.forEach(function (step) {
      if (step.phaseCard) return;
      if (!step.major) return;
      var row = document.createElement('div');
      row.className = 'mp-row';
      var age = document.createElement('span');
      age.className = 'mp-age';
      age.textContent = step.age + ' 岁';
      var txt = document.createElement('span');
      txt.className = 'mp-text';
      txt.textContent = (step.title || '') + '：' + (step.text || '');
      row.appendChild(age);
      row.appendChild(txt);
      path.appendChild(row);
    });

    show('end');
    var scroller = document.querySelector('#screen-end .scroll');
    if (scroller) scroller.scrollTop = 0;
  }

  /* ---------- 设置 ---------- */
  function renderSettings() {
    Array.prototype.forEach.call($('seg-speed').children, function (b) {
      b.classList.toggle('is-on', b.dataset.speed === settings.textSpeed);
    });
    $('chk-motion').checked = !!settings.reduceMotion;
    $('about').innerHTML = '人生模拟器 v' + D.VERSION + '<br>' +
      '从出生到死亡：人生节点（大事件）、叛逆子系统、三类死亡（寿终正寝 / 疾病 / 意外）、多维人生评价。';
  }

  function openSettings() {
    returnScreen = currentScreen();
    if (returnScreen === 'life') saveNow();
    renderSettings();
    show('settings');
  }

  function closeSettings() {
    var target = returnScreen || 'title';
    if (target === 'life' && game && !game.death) {
      show('life');
      renderHeader();
      if (game.pending) renderNodeCard();
      scrollLog();
    } else if (target === 'end' && game && game.death) {
      showEnd(game.death);
    } else if (target === 'setup' && draft) {
      show('setup');
      updateSetupState();
    } else {
      refreshTitle();
      show('title');
    }
  }

  /* ---------- 绑定 ---------- */
  function bind() {
    $('version').textContent = 'v' + D.VERSION;

    $('btn-start').addEventListener('click', function () {
      var old = S.loadGame();
      /* 不弹 confirm：部分浏览器会静默拦截，导致按钮看起来没反应。
         新人生就是新档，旧档直接清掉；想接着玩就别点这里。 */
      S.clearSave();
      undoHistory = [];
      S.clearHistory();
      refreshTitle();
      draft = newDraft();
      renderSetup();
      show('setup');
      if (old && !old.death) toast('上一局存档已清除', 1800);
    });

    $('btn-continue').addEventListener('click', function () {
      var save = S.loadGame();
      if (save && !save.death) {
        undoHistory = S.loadHistory();
        game = save;
        enterLife();
      } else {
        refreshTitle();
      }
    });

    $('btn-settings').addEventListener('click', openSettings);

    $('btn-setup-back').addEventListener('click', function () { show('title'); refreshTitle(); });

    $('attr-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn || !btn.dataset.key) return;
      var changed = E.adjustAttr(draft.attrs, btn.dataset.key, btn.dataset.act === 'plus' ? 1 : -1);
      if (changed) updateSetupState();
    });

    $('btn-reroll').addEventListener('click', function () { draft.attrs = E.rollAttrs(); renderSetup(); });
    $('btn-average').addEventListener('click', averageAttrs);

    $('btn-talent-reroll').addEventListener('click', function () {
      draft.talentId = null;
      draft.talents = E.rollTalents(3);
      renderSetup();
    });

    $('btn-create').addEventListener('click', function () {
      if ($('btn-create').disabled) return;
      S.clearSave();
      game = E.createLife({
        attrs: draft.attrs,
        talentId: draft.talentId,
        regionId: draft.regionId,
        gender: draft.gender
      });
      saveNow();
      enterLife();
    });

    $('btn-next').addEventListener('click', advance);
    $('btn-auto').addEventListener('click', toggleAuto);
    $('btn-undo').addEventListener('click', restoreUndo);
    $('btn-undo-end').addEventListener('click', restoreUndo);
    $('btn-life-settings').addEventListener('click', openSettings);

    /* 退出：自动存档，回到标题；自动播放同时停止 */
    $('btn-exit').addEventListener('click', function () {
      if (!game) { show('title'); refreshTitle(); return; }
      autoOn = false;
      clearAuto();
      updateAutoBtn();
      if (!game.death) {
        saveNow();
        toast('已存档，下次点「继续上次」接着来', 2200);
      }
      show('title');
      refreshTitle();
    });

    $('btn-end-again').addEventListener('click', function () {
      draft = newDraft();
      renderSetup();
      show('setup');
    });

    $('btn-end-home').addEventListener('click', function () { refreshTitle(); show('title'); });

    $('btn-settings-back').addEventListener('click', closeSettings);

    $('seg-speed').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      settings.textSpeed = btn.dataset.speed;
      S.saveSettings(settings);
      renderSettings();
    });

    $('chk-motion').addEventListener('change', function (e) {
      settings.reduceMotion = e.target.checked;
      S.saveSettings(settings);
      applySettingsToBody();
    });

    $('btn-reset').addEventListener('click', function () {
      if (!window.confirm('清除后，本机的存档、设置与记录都会消失。确定吗？')) return;
      S.resetAll();
      settings = S.loadSettings();
      applySettingsToBody();
      renderSettings();
      game = null;
      refreshTitle();
      toast('本地数据已清除');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!$('screen-life').classList.contains('is-active')) return;
      if ($('btn-next').disabled) return;
      e.preventDefault();
      advance();
    });

    document.addEventListener('visibilitychange', function () { if (document.hidden) saveNow(); });
    window.addEventListener('beforeunload', saveNow);
  }

  function init() {
    bind();
    applySettingsToBody();
    refreshTitle();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
