/* =========================================================
 * 人生模拟器 v3 · 系统支撑（存档 / 设置 / 统计）
 * 键名 v3，旧版本存档互不干扰
 * ========================================================= */
(function (root) {
  'use strict';

  var KEY_SAVE = 'lifesim.v3.save';
  var KEY_SETTINGS = 'lifesim.v3.settings';
  var KEY_STATS = 'lifesim.v3.stats';

  var DEFAULT_SETTINGS = { textSpeed: 'normal', reduceMotion: false, agentAll: false };
  var lastError = '';

  function hasStorage() {
    try {
      var k = '__ls3__';
      root.localStorage.setItem(k, '1');
      root.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  }

  function readJSON(key, fallback) {
    try {
      var raw = root.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) || fallback;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, value) {
    try {
      root.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      lastError = (e && e.name === 'QuotaExceededError') ? '浏览器存储空间已满' : '浏览器存储不可用';
      return false;
    }
  }

  function valid(s) {
    if (!s || typeof s !== 'object') return false;
    if (typeof s.age !== 'number') return false;
    if (!s.attrs || typeof s.attrs !== 'object') return false;
    if (!Array.isArray(s.path)) return false;
    return true;
  }

  function saveGame(state) {
    if (!state) return false;
    if (!hasStorage()) { lastError = '此环境无法使用本地存储'; return false; }
    return writeJSON(KEY_SAVE, { savedAt: Date.now(), state: state });
  }

  function loadGame() {
    if (!hasStorage()) return null;
    var p = readJSON(KEY_SAVE, null);
    if (!p || !p.state || !valid(p.state)) return null;
    return p.state;
  }

  function clearSave() {
    try { root.localStorage.removeItem(KEY_SAVE); } catch (e) { /* ignore */ }
  }

  function loadSettings() {
    var s = readJSON(KEY_SETTINGS, null);
    var out = { textSpeed: DEFAULT_SETTINGS.textSpeed, reduceMotion: DEFAULT_SETTINGS.reduceMotion, agentAll: DEFAULT_SETTINGS.agentAll };
    if (s && typeof s === 'object') {
      if (s.textSpeed === 'off' || s.textSpeed === 'fast' || s.textSpeed === 'normal') out.textSpeed = s.textSpeed;
      if (typeof s.reduceMotion === 'boolean') out.reduceMotion = s.reduceMotion;
      if (typeof s.agentAll === 'boolean') out.agentAll = s.agentAll;
    }
    return out;
  }

  function saveSettings(s) { return writeJSON(KEY_SETTINGS, s); }

  function recordRun(death) {
    if (!hasStorage() || !death) return;
    var runs = readJSON(KEY_STATS, []);
    if (!Array.isArray(runs)) runs = [];
    runs.unshift({
      age: death.age, cause: death.name, title: death.title,
      grade: death.grade, overall: death.dims.overall, at: Date.now()
    });
    while (runs.length > 20) runs.pop();
    writeJSON(KEY_STATS, runs);
  }

  function getRuns() {
    var runs = readJSON(KEY_STATS, []);
    return Array.isArray(runs) ? runs : [];
  }

  function resetAll() {
    [KEY_SAVE, KEY_SETTINGS, KEY_STATS, HISTORY_KEY].forEach(function (k) {
      try { root.localStorage.removeItem(k); } catch (e) { /* ignore */ }
    });
  }

  var HISTORY_KEY = 'lifesim.v3.history';
  var HISTORY_MAX = 25;

  function saveHistory(list) {
    try {
      var arr = (list || []).slice(-HISTORY_MAX);
      root.localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
    } catch (e) { /* 空间不够就放弃持久化 */ }
  }

  function loadHistory() {
    try {
      var raw = root.localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.slice(-HISTORY_MAX) : [];
    } catch (e) { return []; }
  }

  function clearHistory() {
    try { root.localStorage.removeItem(HISTORY_KEY); } catch (e) {}
  }

  root.LifeStorage = {
    hasStorage: hasStorage,
    saveGame: saveGame,
    loadGame: loadGame,
    saveHistory: saveHistory,
    loadHistory: loadHistory,
    clearHistory: clearHistory,
    clearSave: clearSave,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    recordRun: recordRun,
    getRuns: getRuns,
    resetAll: resetAll,
    getLastError: function () { return lastError; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
