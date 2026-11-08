/* =========================================================
 * 人生轨道配乐
 * - 默认：程序化生成（五声音阶琶音 + 低音铺底），无版权问题
 * - 可选：把 assets/audio/bgm.mp3 放进来，会优先播放它
 * ========================================================= */
(function (root) {
  var ctx = null;
  var master = null;
  var timer = null;
  var el = null;
  var playing = false;

  var BPM = 64;
  var BEAT = 60 / BPM;

  /* C 大调五声音阶，柔和、克制 */
  var MELODY = [523.25, 392.00, 440.00, 329.63, 293.66, 440.00, 392.00, 329.63];
  var BASS = [130.81, 110.00, 98.00, 110.00];

  function ensureCtx() {
    if (!ctx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.0;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  function note(freq, at, dur, vol, type) {
    var t0 = ctx.currentTime + at;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    var lp = ctx.createBiquadFilter();

    osc.type = type || 'triangle';
    osc.frequency.value = freq;
    lp.type = 'lowpass';
    lp.frequency.value = 1800;

    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(lp);
    lp.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function schedule(fromBeat) {
    /* 每 8 拍一个循环：琶音 + 低音 */
    for (var i = 0; i < 8; i++) {
      var b = fromBeat + i;
      var at = (b) * BEAT;
      note(MELODY[b % MELODY.length], at, 1.4, 0.10, 'triangle');
      if (i % 4 === 0) note(BASS[(b / 4) % BASS.length | 0], at, 2.6, 0.07, 'sine');
    }
  }

  function startExternal() {
    el = new Audio('assets/audio/bgm.mp3');
    el.loop = true;
    el.volume = 0.55;
    el.play().then(function () { playing = true; }).catch(function () {
      el = null;
      startSynth();
    });
  }

  function startSynth() {
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.2);

    playing = true;
    var beat = 0;
    schedule(0);
    beat = 8;
    timer = setInterval(function () {
      schedule(beat);
      beat += 8;
    }, BEAT * 8000);
  }

  function start() {
    if (playing) return;
    /* 有外部音频就用外部音频，否则用程序化音源 */
    fetch('assets/audio/bgm.mp3', { method: 'HEAD' })
      .then(function (r) { r.ok ? startExternal() : startSynth(); })
      .catch(function () { startSynth(); });
  }

  function stop() {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (el) { try { el.pause(); } catch (e) {} el = null; }
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
    }
  }

  root.LifeAudio = { start: start, stop: stop, isPlaying: function () { return playing; }, beat: BEAT };
})(window);
