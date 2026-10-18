/* Sky Patrol — tiny Web Audio sound bank.
 * No audio files: every sound is synthesised, so the game stays small and
 * loads instantly. The context is created on the first user gesture. */
window.SP = window.SP || {};

(function (SP) {
  'use strict';

  var STORE_KEY = 'sky-patrol:sound';

  function readMuted() {
    try { return localStorage.getItem(STORE_KEY) === 'off'; } catch (err) { return false; }
  }

  function writeMuted(muted) {
    try { localStorage.setItem(STORE_KEY, muted ? 'off' : 'on'); } catch (err) { /* private mode */ }
  }

  var muted = readMuted();
  var ctx = null;
  var master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
    return ctx;
  }

  function tone(opts) {
    if (muted) return;
    var c = ensure();
    if (!c) return;

    var t = c.currentTime;
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = opts.wave || 'square';
    osc.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1 && opts.f1 !== opts.f0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f1), t + opts.dur);
    }
    var vol = opts.vol == null ? 0.5 : opts.vol;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + opts.dur + 0.02);
  }

  function noise(opts) {
    if (muted) return;
    var c = ensure();
    if (!c) return;

    var t = c.currentTime;
    var frames = Math.max(1, Math.floor(c.sampleRate * opts.dur));
    var buffer = c.createBuffer(1, frames, c.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    var src = c.createBufferSource();
    src.buffer = buffer;

    var filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(opts.f0, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, opts.f1 || 200), t + opts.dur);

    var gain = c.createGain();
    var vol = opts.vol == null ? 0.5 : opts.vol;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);

    src.connect(filter).connect(gain).connect(master);
    src.start(t);
  }

  var SOUNDS = {
    shoot: function () { tone({ wave: 'square', f0: 820, f1: 320, dur: 0.08, vol: 0.16 }); },
    laser: function () { tone({ wave: 'sawtooth', f0: 1400, f1: 380, dur: 0.12, vol: 0.14 }); },
    enemyShoot: function () { tone({ wave: 'triangle', f0: 260, f1: 120, dur: 0.14, vol: 0.14 }); },
    explode: function () { noise({ f0: 1400, f1: 160, dur: 0.34, vol: 0.34 }); },
    bigExplode: function () {
      noise({ f0: 2200, f1: 90, dur: 0.75, vol: 0.5 });
      tone({ wave: 'sawtooth', f0: 180, f1: 40, dur: 0.5, vol: 0.25 });
    },
    pickup: function () {
      tone({ wave: 'sine', f0: 660, f1: 990, dur: 0.1, vol: 0.3 });
      tone({ wave: 'sine', f0: 990, f1: 1320, dur: 0.12, vol: 0.22 });
    },
    hurt: function () {
      tone({ wave: 'sawtooth', f0: 300, f1: 80, dur: 0.28, vol: 0.34 });
      noise({ f0: 900, f1: 200, dur: 0.2, vol: 0.2 });
    },
    shield: function () { tone({ wave: 'sine', f0: 520, f1: 1180, dur: 0.22, vol: 0.28 }); },
    emp: function () { tone({ wave: 'sawtooth', f0: 1200, f1: 120, dur: 0.5, vol: 0.3 }); },
    wave: function () {
      [523, 659, 784].forEach(function (f, i) {
        setTimeout(function () { tone({ wave: 'triangle', f0: f, f1: f, dur: 0.18, vol: 0.26 }); }, i * 110);
      });
    },
    boss: function () {
      [392, 330, 262].forEach(function (f, i) {
        setTimeout(function () { tone({ wave: 'sawtooth', f0: f, f1: f * 0.98, dur: 0.3, vol: 0.3 }); }, i * 160);
      });
    },
    victory: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        setTimeout(function () { tone({ wave: 'triangle', f0: f, f1: f, dur: 0.3, vol: 0.3 }); }, i * 140);
      });
    },
    gameover: function () {
      [440, 370, 294, 220].forEach(function (f, i) {
        setTimeout(function () { tone({ wave: 'sawtooth', f0: f, f1: f * 0.97, dur: 0.34, vol: 0.26 }); }, i * 180);
      });
    },
    ui: function () { tone({ wave: 'triangle', f0: 620, f1: 780, dur: 0.07, vol: 0.18 }); }
  };

  SP.Audio = {
    /* Call from the first real user gesture so the context can start. */
    unlock: function () { if (!muted) ensure(); },
    play: function (name) {
      if (muted) return;
      var fn = SOUNDS[name];
      if (fn) { try { fn(); } catch (err) { /* audio is never fatal */ } }
    },
    isMuted: function () { return muted; },
    setMuted: function (next) {
      muted = !!next;
      writeMuted(muted);
      if (!muted) ensure();
      return muted;
    },
    toggle: function () { return SP.Audio.setMuted(!muted); }
  };
})(window.SP);