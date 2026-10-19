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
  var API = 'https://api.start.ng';
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
  var GAME = ON_START_NG ? location.hostname.split('.')[0] : '';
  var listeners = [];

  var identity = {
    status: 'loading', /* 'signed-in' | 'guest' | 'offline' | 'loading' */
    signedIn: false,
    pending: false, /* signed in, but start.ng has not confirmed it yet */
    id: null,
    name: 'Guest',
    account: '',
    face: '',
    style: null /* Start.ng character style, or null before we know */
  };

  /* ------------------------------------------------------------------ *
   * the game session
   * ------------------------------------------------------------------ */

  /* start.ng sends the player back here after signing in, with a session in
     the address. The connect page can ignore it — but it is proof they just
     signed in, and it lets us confirm that over the HTTP API when the connect
     page has not caught up yet. */
  function readSession() {
    try {
      var hash = location.hash.slice(1);
      if (hash) {
        var fromHash = new URLSearchParams(hash).get('startng_session');
        if (fromHash) {
          sessionStorage.setItem('startng_session', fromHash);
          history.replaceState(null, '', location.pathname + location.search);
          return fromHash;
        }
      }
      return sessionStorage.getItem('startng_session') || null;
    } catch (err) {
      return null;
    }
  }

  var session = readSession();

  function dropSession() {
    session = null;
    try { sessionStorage.removeItem('startng_session'); } catch (err) { /* private mode */ }
  }

  /* Who is playing, over the HTTP API. This does not go through the connect
     page at all, so it can prove a sign-in the connect page has not noticed
     yet — which is exactly what happens when you sign in and come straight
     back to the game. */
  function playerFromApi() {
    if (!session || !GAME) return Promise.resolve(null);
    return fetch(API + '/games/' + GAME + '/player', {
      headers: { 'Authorization': 'Bearer ' + session }
    }).then(function (r) {
      if (r.status === 401) { dropSession(); return null; }
      if (!r.ok) return null;
      return r.json();
    }).catch(function () { return null; });
  }

  /* Saves over the HTTP API, as a fallback when the connect page will not. */
  function saveViaApi(stats) {
    if (!session || !GAME) return Promise.resolve(null);
    return fetch(API + '/games/' + GAME + '/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session },
      body: JSON.stringify({ stats: stats })
    }).then(function (r) {
      if (r.status === 401) { dropSession(); return null; }
      if (!r.ok) return null;
      return r.json();
    }).catch(function () { return null; });
  }

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
      return setIdentity(user || guest, !!user, user ? user.account : '');
    }

    return askStartNg({ type: 'startng:whoami' }, 'startng:user').then(function (reply) {
      if (reply) return apply(reply);
      return askStartNg({ type: 'startng:whoami' }, 'startng:user').then(function (again) {
        return again ? apply(again) : apply(null);
      });
    }).then(function () {
      /* The connect page may not have noticed a sign-in that just happened.
         If we hold a session, confirm it over the API rather than leaving a
         signed-in player looking like a guest. */
      if (identity.signedIn || !session) {
        identity.pending = false;
        return identity;
      }
      return playerFromApi().then(function (player) {
        if (player) {
          setIdentity(player, true, '');
          return identity;
        }
        /* Only claim we are pending if we still hold a session. If start.ng
           rejected it, it is no use asking again. */
        if (!session) {
          identity.pending = false;
          emit();
          return identity;
        }
        identity.pending = true;
        emit();
        return identity;
      });
    });
  }

  function setIdentity(player, signedIn, account) {
    identity.status = signedIn ? 'signed-in' : (player ? 'guest' : 'offline');
    identity.signedIn = !!signedIn;
    identity.id = signedIn && player && player.id != null ? player.id : null;
    identity.name = (player && player.name) || (signedIn ? 'Pilot' : 'Guest');
    identity.account = account || '';
    if (player && player.face) identity.face = player.face;
    identity.style = (player && player.style) || identity.style;
    emit();
    return identity;
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
    var clean = cleanStats(stats);

    function refused() {
      return {
        ok: false,
        reason: identity.status === 'offline' ? 'offline' : 'guest',
        error: identity.status === 'offline'
          ? 'Run saved on this device only — scoring needs start.ng.'
          : 'Sign in with start.ng to save this run.'
      };
    }

    /* A session can be perfectly valid even while the connect page still
       thinks you are a guest. Try the API before turning the player away —
       refusing here is what makes a signed-in player think sign-in failed. */
    if (!identity.signedIn) {
      if (!session) return Promise.resolve(refused());
      return saveViaApi(clean).then(function (result) {
        if (result) return { ok: true, result: result };
        return refused();
      });
    }

    return askStartNg({ type: 'startng:score', stats: clean }, 'startng:scoreSaved').then(function (reply) {
      if (!reply) {
        return saveViaApi(clean).then(function (result) {
          if (result) return { ok: true, result: result };
          return { ok: false, reason: 'offline', error: 'start.ng did not answer, so this run was not saved.' };
        });
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
    /* True when the player holds a session from a sign-in redirect. */
    hasSession: function () { return !!session; },
    /* True when the player opened the game as a guest (?guest) or as nobody. */
    guestMode: new URLSearchParams(location.search).has('guest')
  };
})(window.SP);