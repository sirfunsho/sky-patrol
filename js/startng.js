/* Sky Patrol — Start.ng integration.
 *
 * Talks to Start.ng through its hidden connect page with postMessage, as
 * documented at https://start.ng/docs.md. No secrets, no accounts of our own:
 * Start.ng owns sign-in, characters and the leaderboard.
 *
 * Guest players and anyone opening the game outside *.start.ng still play;
 * every call resolves to null / { ok: false } instead of throwing.
 */
window.SP = window.SP || {};

(function (SP) {
  'use strict';

  var START_NG = 'https://start.ng';
  var TIMEOUT_MS = 5000;

  /* The four leaderboard columns, in ranking order. Mirrors startng.json.
     The run is endless, so there is no win column: score leads, then how
     deep you got, then shootdowns, then how long you lasted. */
  var STAT_KEYS = ['score', 'waves', 'kills', 'time'];
  var STAT_LIMIT = 1000000000;

  var framePromise = null;
  /* The connect page only answers games served from a *.start.ng address.
     Anywhere else — localhost, a file on disk — there is nothing to wait
     for, so the game goes straight to guest/offline without five-second
     stalls on every call. */
  var ON_START_NG = /(^|\.)start\.ng$/i.test(location.hostname);
  var listeners = [];

  var identity = {
    status: 'loading', /* 'signed-in' | 'guest' | 'offline' | 'loading' */
    signedIn: false,
    id: null,
    name: 'Guest',
    account: '',
    face: '',
    style: null /* Start.ng character style, or null before we know */
  };

  function connectFrame() {
    if (!ON_START_NG) return Promise.reject(new Error('not served from start.ng'));
    if (!framePromise) {
      framePromise = new Promise(function (resolve, reject) {
        var el = document.createElement('iframe');
        el.src = START_NG + '/connect';
        el.hidden = true;
        el.setAttribute('aria-hidden', 'true');
        el.tabIndex = -1;
        el.className = 'startng-frame';
        el.style.cssText = 'display:none';

        /* Offline, or blocked: never leave the caller waiting forever. */
        var loadTimer = setTimeout(function () { reject(new Error('connect frame timed out')); }, TIMEOUT_MS);
        el.onload = function () { clearTimeout(loadTimer); resolve(el); };
        el.onerror = function () { clearTimeout(loadTimer); reject(new Error('connect frame failed')); };

        document.body.appendChild(el);
      });
      /* Allow a later retry if this attempt failed. */
      framePromise.catch(function () { framePromise = null; });
    }
    return framePromise;
  }

  /* Sends one message and resolves with Start.ng's reply, or null when it did
     not answer. A timeout is treated as transient: a backgrounded tab, a
     slow network or one dropped reply must not disable identity, scores and
     the leaderboard for the rest of the session, so nothing is latched here. */
  function askStartNg(message, replyType, timeoutMs) {
    return connectFrame().then(function (el) {
      return new Promise(function (resolve) {
        var requestId = Math.random().toString(36).slice(2);
        var timer = setTimeout(function () { done(null); }, timeoutMs || TIMEOUT_MS);

        function done(reply) {
          clearTimeout(timer);
          window.removeEventListener('message', onMessage);
          resolve(reply);
        }

        function onMessage(e) {
          /* The origin check is what makes the reply trustworthy. */
          if (e.origin !== START_NG || e.source !== el.contentWindow) return;
          if (e.data && e.data.type === replyType && e.data.requestId === requestId) done(e.data);
        }

        window.addEventListener('message', onMessage);
        el.contentWindow.postMessage(Object.assign({}, message, { requestId: requestId }), START_NG);
      });
    }).catch(function () {
      /* the frame itself would not load; the next call tries again */
      return null;
    });
  }

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(identity); } catch (err) { /* a broken listener must not break the game */ }
    });
  }

  /* Who is playing: the signed-in character, or Start.ng's guest look.
     One dropped reply is worth a second try before giving up. */
  function refresh() {
    function apply(reply) {
      if (!reply) {
        identity.status = 'offline';
        identity.signedIn = false;
        identity.id = null;
        emit();
        return identity;
      }

      var user = reply.user || null;
      var guest = reply.guest || null;
      var player = user || guest;

      identity.status = user ? 'signed-in' : 'guest';
      identity.signedIn = !!user;
      identity.id = user ? (user.id != null ? user.id : null) : null;
      identity.name = (player && player.name) || (user ? 'Pilot' : 'Guest');
      identity.account = (user && user.account) || '';
      identity.face = (player && player.face) || '';
      identity.style = (player && player.style) || null;

      emit();
      return identity;
    }

    return askStartNg({ type: 'startng:whoami' }, 'startng:user').then(function (reply) {
      if (reply) return apply(reply);
      return askStartNg({ type: 'startng:whoami' }, 'startng:user').then(apply);
    });
  }

  /* Whole numbers only, 0 .. 1,000,000,000, and only the declared columns. */
  function cleanStats(stats) {
    var out = {};
    STAT_KEYS.forEach(function (key) {
      var n = Math.round(Number(stats && stats[key]));
      if (!isFinite(n) || n < 0) n = 0;
      out[key] = Math.min(STAT_LIMIT, n);
    });
    return out;
  }

  /* Saves the run. Signed-in players only; everyone else gets a clear reason. */
  function saveRun(stats) {
    if (!identity.signedIn) {
      return Promise.resolve({
        ok: false,
        reason: identity.status === 'offline' ? 'offline' : 'guest',
        error: identity.status === 'offline'
          ? 'Run saved on this device only — scoring needs start.ng.'
          : 'Sign in with start.ng to save this run.'
      });
    }

    return askStartNg({ type: 'startng:score', stats: cleanStats(stats) }, 'startng:scoreSaved').then(function (reply) {
      if (!reply) {
        return { ok: false, reason: 'offline', error: 'start.ng did not answer, so this run was not saved.' };
      }
      if (!reply.ok) {
        return { ok: false, reason: 'error', error: reply.error || 'start.ng could not save this run.' };
      }
      return { ok: true, result: reply.result || null };
    });
  }

  /* The board works for everyone, guests included. */
  function leaderboard(limit) {
    return askStartNg({ type: 'startng:leaderboard', limit: limit || 10 }, 'startng:leaderboardData')
      .then(function (reply) {
        if (!reply || !reply.ok) return { ok: false, entries: [] };
        return { ok: true, entries: reply.entries || [] };
      });
  }

  /* start.ng sends players back here after signing in. */
  function signInUrl() {
    return 'https://start.ng/?return_to=' + encodeURIComponent(location.origin + location.pathname);
  }

  SP.StartNG = {
    identity: identity,
    statKeys: STAT_KEYS,
    refresh: refresh,
    saveRun: saveRun,
    leaderboard: leaderboard,
    signInUrl: signInUrl,
    onChange: function (fn) { listeners.push(fn); },
    /* True when the player opened the game as a guest (?guest) or as nobody. */
    guestMode: new URLSearchParams(location.search).has('guest')
  };
})(window.SP);