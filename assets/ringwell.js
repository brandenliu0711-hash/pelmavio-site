/* Ringwell v2 story engine. Same-origin, no dependencies, no network, no cookies, no storage.
 * Loaded in <head> so the page picks its layout before first paint (no layout shift).
 * Without this file, with prefers-reduced-motion, or with ?static=1 (a harmless QA switch),
 * the page shows the static composition.
 * Motion model: scroll position -> critically damped spring (momentum) -> discrete beats;
 * beats drive CSS transitions eased with spring curves (linear()), and the flying words
 * use their own under-damped springs, so every move is interruptible and reversible.
 * Frame discipline: geometry is measured once per resize (measure); each frame reads rects
 * first, then writes transform/opacity/custom properties only. */
(function () {
  'use strict';
  var w = window, d = document, root = d.documentElement;
  var reduce = !w.matchMedia || w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var forceStatic = /(?:^|[?&])static=1(?:&|$)/.test(w.location.search);
  if (reduce || forceStatic || !w.requestAnimationFrame) return;
  var hasView = !!(w.CSS && CSS.supports && CSS.supports('animation-timeline: view()'));
  if (!hasView && 'IntersectionObserver' in w) root.classList.add('io');
  root.classList.add('live');

  d.addEventListener('DOMContentLoaded', function () {
    if (root.classList.contains('io')) reveal();
    week();
    try { story(); } catch (e) { root.classList.remove('live'); if (w.console) console.error(e); }
  });

  /* IntersectionObserver fallback for the CSS scroll-driven reveals */
  function reveal() {
    var els = d.querySelectorAll('.shot-ring circle,.bigring circle,.claims b,.principles h3');
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.35 });
    for (var i = 0; i < els.length; i++) io.observe(els[i]);
  }

  /* History section: the week's circles fill in, one day after another, when the screen comes into view */
  function week() {
    var rec = d.querySelector('.record');
    if (!rec) return;
    var target = rec.querySelector('.hist') || rec;
    if (!('IntersectionObserver' in w)) { rec.classList.add('seen'); return; }
    var io = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) { rec.classList.add('seen'); io.disconnect(); }
    }, { threshold: 0.45 });
    io.observe(target);
  }

  /* damped spring; zeta = damping ratio, resp = response in seconds (Apple's two-parameter form) */
  function Spring(x, zeta, resp) { this.x = x; this.v = 0; this.t = x; this.z = zeta; this.w = 2 * Math.PI / resp; }
  Spring.prototype.step = function (dt) {
    var n = Math.ceil(dt / 0.004), h = dt / n;
    for (var i = 0; i < n; i++) {
      var a = -this.w * this.w * (this.x - this.t) - 2 * this.z * this.w * this.v;
      this.v += a * h; this.x += this.v * h;
    }
    if (Math.abs(this.x - this.t) < 1e-4 && Math.abs(this.v) < 1e-3) { this.x = this.t; this.v = 0; return false; }
    return true;
  };
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function smooth(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
  /* layout offset of el inside anc (ignores transforms, so it can be read at any time) */
  function offIn(el, anc) { var y = 0; while (el && el !== anc) { y += el.offsetTop; el = el.offsetParent; } return y; }

  function story() {
    var sec = d.querySelector('.story');
    if (!sec) return;
    var stage = sec.querySelector('.stage');
    var sentence = stage.querySelector('.sentence');
    var words = sentence.querySelectorAll('.w:not(.q)');
    var N = words.length;
    var bars = stage.querySelectorAll('.wave i');
    var mini = stage.querySelectorAll('.ui-wave i');
    var caps = stage.querySelectorAll('.cap');
    var rail = stage.querySelectorAll('.rail a');
    var railNav = stage.querySelector('.rail');
    var confirm = stage.querySelector('.s-confirm');
    var phone = stage.querySelector('.phone'), caps0 = stage.querySelector('.caps'), say = stage.querySelector('.say'), device = stage.querySelector('.device');
    function q(s) { return phone.querySelector(s); }

    /* beat thresholds on the smoothed progress (0..1 across the pinned section) */
    var T = [0, .12, .15, .18, .21, .24, .27, .33, .44, .48, .51, .56, .61, .68, .73, .79, .83, .87, .91, .95];
    var START = [0, .125, .335, .485, .685];
    function actOf(b) { return b < 1 ? 0 : b < 7 ? 1 : b < 9 ? 2 : b < 13 ? 3 : 4; }

    /* word timing for the auto-played sentence */
    var cum = [0], cjk = /[㐀-鿿]/;
    for (var i = 0; i < N; i++) {
      var tx = words[i].textContent;
      cum.push(cum[i] + (cjk.test(tx) ? 120 + 150 * tx.length : 130 + 40 * tx.length));
    }

    /* ghosts: each parsed phrase flies from the sentence into its field, then hands over to the real field */
    var ghosts = [];
    var phs = sentence.querySelectorAll('.phr');
    for (var k = 0; k < phs.length; k++) {
      var ph = phs[k];
      var dd = confirm && confirm.querySelector('[data-f="' + ph.getAttribute('data-f') + '"] dd');
      if (!dd) continue;
      var g = d.createElement('div'); g.className = 'ghost'; g.setAttribute('aria-hidden', 'true');
      var ga = d.createElement('span'); ga.className = 'g-a'; ga.textContent = ph.textContent;
      var gb = d.createElement('span'); gb.className = 'g-b'; gb.textContent = dd.textContent;
      g.appendChild(ga); g.appendChild(gb); stage.appendChild(g);
      ghosts.push({ ph: ph, dd: dd, el: g, a: ga, b: gb, s: new Spring(0, 0.58, 0.55), beat: 2 + k, m: null, vis: -1, landed: -1 });
    }

    var isActive = false, mobile = false, geo = null;
    var P, env = new Spring(0, 1, 0.22);
    var ready = false, settleUntil = 0, beat = -1, act = -1, screen = '', prevSay = 0, running = false, last = 0, wasActive = false;

    /* everything that needs layout is read here, once per resize, never inside the scroll loop */
    function measure() {
      isActive = getComputedStyle(stage).position === 'sticky';
      mobile = w.innerWidth < 900;
      if (!isActive) return;
      geo = mobile ? camera() : null;
      if (!mobile) ['--wt', '--cy', '--cs', '--D', '--dt', '--k'].forEach(function (p) { stage.style.removeProperty(p); });
      for (var i = 0; i < ghosts.length; i++) {
        var G = ghosts[i];
        G.tf = parseFloat(getComputedStyle(G.dd).fontSize) || 12;
        G.sf = parseFloat(getComputedStyle(G.ph).fontSize) || 30;
        G.el.style.fontSize = G.tf + 'px';
        G.dh = G.dd.offsetHeight;
        G.m = true;
      }
      if (act >= 0) place(beat, act);
    }

    /* phones: per act, the window between the caption and the step pill; the whole phone is
       scaled to fit inside it (frame and full screen, no cropping, nothing under the pill).
       Proportion k (height / width) goes from 2.08 down to 1.85 on short screens, where the
       screens' em-based type is bounded by their height (cqh), so the text stays as large as it can. */
    function camera() {
      var W = phone.offsetWidth, vw = w.innerWidth;
      /* short screens: drop the Understand paragraph only if it would push the sentence down */
      stage.classList.remove('p1-off');
      var p1 = caps[1].lastElementChild, c0 = caps[0].querySelector('.sub') || caps[0].lastElementChild;
      if (stage.clientHeight < 760 && p1 && c0 && offIn(p1, caps0) + p1.offsetHeight > offIn(c0, caps0) + c0.offsetHeight + 4) stage.classList.add('p1-off');
      var capTop = caps0.offsetTop, winBottom = railNav.offsetTop - 14;
      var tops = [];
      for (var a = 0; a < caps.length; a++) {
        var c = caps[a], bottom = c.offsetTop + c.offsetHeight;
        if (a <= 1) bottom = Math.max(bottom, say.offsetTop + say.offsetHeight);
        /* acts 0-1: leave room for the field tags that hang under the sentence */
        tops.push(Math.round(capTop + bottom + (a <= 1 ? 22 : 12)));
      }
      var winMin = 1e9;
      for (var t = 0; t < tops.length; t++) winMin = Math.min(winMin, winBottom - tops[t]);
      var k = clamp(winMin / W, 1.85, 2.08);
      stage.style.setProperty('--k', k.toFixed(3));
      var Hp = W * k;
      function fit(top, dial) {
        var win = winBottom - top, s = Math.min(1, win / Hp), D = 0, arc = 0;
        if (dial) {
          /* acts 3-4: the dial crowns the phone; solve scale and crown height together */
          for (var i = 0; i < 6; i++) {
            D = Math.min(vw - 10, W * s + 72);
            var R = D / 2, half = W * s / 2;
            arc = R - Math.sqrt(Math.max(0, R * R - half * half)) + 8;
            s = Math.min(0.92, (win - arc) / Hp);
          }
        }
        var spare = Math.max(0, win - arc - Hp * s), off = Math.round(spare / 2);
        return { wt: top, s: +s.toFixed(4), y0: Math.round(top + off + arc), dt: top + off, D: Math.round(D) };
      }
      var acts = [];
      for (var b = 0; b < tops.length; b++) acts.push(fit(tops[b], b >= 3));
      /* the week view (beats 15+) no longer needs the dial: the phone steps up into its place */
      acts.push(fit(tops[4], false));
      return { acts: acts, winBottom: winBottom };
    }

    function place(b, a) {
      if (!geo || b < 0) return;
      var A = geo.acts[b >= 15 ? 5 : a];
      stage.style.setProperty('--wt', A.wt + 'px');
      stage.style.setProperty('--cy', A.y0 + 'px');
      stage.style.setProperty('--cs', A.s);
      if (A.D) stage.style.setProperty('--D', A.D + 'px');
      stage.style.setProperty('--dt', A.dt + 'px');
    }

    function rawP(r) {
      var span = sec.offsetHeight - w.innerHeight;
      return span > 0 ? clamp(-r.top / span, 0, 1) : 0;
    }

    var autoStart = -1;

    function autoSay(now) {
      if (autoStart < 0) return N;
      var e = now - autoStart;
      if (e <= 0) return 0;
      for (var i = 0; i < N; i++) if (e < cum[i + 1]) return i + (e - cum[i]) / (cum[i + 1] - cum[i]);
      return N;
    }

    function setBeat(b) {
      beat = b;
      var a = actOf(b), st = stage.dataset, scr;
      st.beat = b;
      if (a !== act) {
        act = a; st.act = a;
        settleUntil = performance.now() + 1100;
        for (var i = 0; i < caps.length; i++) caps[i].style.setProperty('--y', i < a ? -1 : 1);
        for (var j = 0; j < rail.length; j++) {
          if (j === a) rail[j].setAttribute('aria-current', 'step'); else rail[j].removeAttribute('aria-current');
        }
      }
      if (mobile) { place(b, a); settleUntil = Math.max(settleUntil, performance.now() + 900); }
      scr = a === 0 ? 'listen' : a < 3 ? 'confirm' : a === 3 ? 'alarm' : b < 15 ? 'dose' : 'week';
      if (scr !== screen) { screen = scr; st.screen = scr; }
      st.ring = (b === 10 || b === 12) ? 'on' : 'off';
      flag('saved', b >= 8); flag('stopped', b >= 11); flag('second', b >= 12); flag('marked', b >= 14); flag('full', b >= 19);
      stage.style.setProperty('--lit', b >= 12 ? 2 : b >= 10 ? 1 : 0);
      stage.style.setProperty('--days', Math.max(0, b - 14));
    }
    function flag(n, on) { if (on) stage.setAttribute('data-' + n, ''); else stage.removeAttribute('data-' + n); }

    function clear() {
      ['--say', '--p', '--rb', '--lit', '--days', '--wt', '--cy', '--cs', '--D', '--dt', '--k'].forEach(function (p) { stage.style.removeProperty(p); });
      stage.classList.remove('p1-off');
      ['beat', 'ring', 'saved', 'stopped', 'second', 'marked', 'full', 'speaking'].forEach(function (n) { stage.removeAttribute('data-' + n); });
      stage.classList.remove('ready'); ready = false;
      stage.dataset.act = 0; stage.dataset.screen = 'listen';
      for (var i = 0; i < ghosts.length; i++) { ghosts[i].el.style.opacity = 0; ghosts[i].vis = -1; ghosts[i].landed = -1; ghosts[i].ph.style.removeProperty('--g'); ghosts[i].dd.style.removeProperty('opacity'); }
      for (var j = 0; j < bars.length; j++) bars[j].style.transform = '';
      for (var m = 0; m < mini.length; m++) mini[m].style.transform = '';
      beat = act = -1; screen = '';
    }

    var stats = { frames: 0, ms: 0, read: 0, worst: 0, slow: [] };
    function frame(now) {
      var t0 = performance.now();
      if (!isActive) { if (wasActive) clear(); wasActive = false; running = false; return; }
      /* ---- reads ---- */
      var secR = sec.getBoundingClientRect();
      var tracking = (act === 1 || act === 2) || now < settleUntil;
      for (var gi = 0; gi < ghosts.length && !tracking; gi++) if (ghosts[gi].s.x !== ghosts[gi].s.t) tracking = true;
      if (tracking) {
        var sr = stage.getBoundingClientRect(), dv = device.getBoundingClientRect();
        var limit = mobile && geo ? geo.winBottom : dv.top - sr.top + dv.height;
        var ceil = mobile && geo && act >= 0 ? geo.acts[act].wt : -1e9;
        for (var gq = 0; gq < ghosts.length; gq++) {
          var H = ghosts[gq]; if (!H.m) continue;
          var a = H.ph.getBoundingClientRect(), z = H.dd.getBoundingClientRect();
          var sx = a.left - sr.left, sy = a.top - sr.top + (a.height - 1.25 * H.sf) / 2, tx = z.left - sr.left, ty = z.top - sr.top;
          H.r = { sx: sx, sy: sy, tx: tx, ty: ty, ks: H.sf / H.tf, kt: z.height / (H.dh || z.height || 1), arc: Math.min(90, Math.hypot(tx - sx, ty - sy) * 0.18), out: ty + z.height > limit || ty < ceil };
        }
      }
      var tRead = performance.now() - t0;
      /* ---- compute ---- */
      if (!wasActive) { wasActive = true; P = new Spring(rawP(secR), 1, 0.32); if (P.x < 0.02 && autoStart < 0) autoStart = now + 650; }
      var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
      P.t = rawP(secR);
      var moving = P.step(dt), p = P.x;
      var b = 0;
      for (var i = T.length - 1; i > 0; i--) if (p >= T[i]) { b = i; break; }

      /* ---- writes ---- */
      if (b !== beat) setBeat(b);
      if (!ready) { ready = true; setTimeout(function () { if (ready) stage.classList.add('ready'); }, 90); }

      var sayN = Math.min(N, Math.max(autoSay(now), clamp(p / 0.1, 0, 1) * N));
      var speaking = sayN < N - 0.001 && sayN > prevSay + 1e-5;
      prevSay = sayN;
      stage.style.setProperty('--say', sayN.toFixed(3));
      stage.style.setProperty('--p', p.toFixed(4));
      stage.style.setProperty('--rb', ((p - 0.335) / 0.085 * 5).toFixed(3));
      if (speaking) stage.setAttribute('data-speaking', ''); else stage.removeAttribute('data-speaking');

      /* live waveform: an envelope (spring) times per-bar oscillators */
      env.t = speaking ? 1 : act === 0 ? 0.14 : 0;
      moving = env.step(dt) || moving;
      var t = now / 1000, n = bars.length;
      if (env.x > 0.001 || speaking) {
        for (var j = 0; j < n; j++) {
          var shape = 0.4 + 0.6 * Math.sin(Math.PI * (j + 0.5) / n);
          var osc = 0.35 + 0.65 * Math.abs(Math.sin(t * (5.1 + (j % 5) * 1.7) + j * 1.3) * Math.sin(t * 2.3 + j * 0.6));
          var h = 0.1 + env.x * shape * osc;
          bars[j].style.transform = 'scaleY(' + h.toFixed(3) + ')';
          if (j < mini.length) mini[j].style.transform = 'scaleY(' + (0.15 + env.x * osc * 0.9).toFixed(3) + ')';
        }
      }

      for (var qn = 0; qn < ghosts.length; qn++) {
        var G = ghosts[qn];
        if (!G.m) continue;
        G.s.t = beat >= G.beat ? 1 : 0;
        moving = G.s.step(dt) || moving;
        var v = G.s.x, c = clamp(v, 0, 1), R = G.r;
        /* at rest on its field, the ghost hands over to the real field (which then moves with the phone) */
        var landed = v === 1 ? 1 : 0;
        if (landed !== G.landed) { G.landed = landed; G.dd.style.opacity = landed; }
        if (R && !landed) {
          var x = R.sx + (R.tx - R.sx) * v, y = R.sy + (R.ty - R.sy) * v - R.arc * Math.sin(Math.PI * c), sc = R.ks + (R.kt - R.ks) * v;
          G.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) scale(' + sc.toFixed(4) + ')';
          var bo = smooth(0.2, 0.55, v);
          G.a.style.opacity = (1 - bo).toFixed(3); G.b.style.opacity = bo.toFixed(3);
        }
        /* a field outside the window: the word dives in and fades */
        var vis = landed || !R ? 0 : v > 0.015 && screen === 'confirm' ? (R.out ? 1 - smooth(0.45, 0.85, v) : 1) : 0;
        if (vis !== G.vis) { G.vis = vis; G.el.style.opacity = vis; }
        G.ph.style.setProperty('--g', c.toFixed(3));
      }

      var cost = performance.now() - t0;
      stats.frames++; stats.ms += cost; stats.read += tRead; if (cost > stats.worst) stats.worst = cost;
      if (cost > 8 && stats.slow.length < 12) stats.slow.push([Math.round(cost), Math.round(tRead), beat, tracking ? 1 : 0]);
      var keep = moving || speaking || now < settleUntil || (act === 0 && secR.bottom > 0 && secR.top < w.innerHeight) || autoSay(now) < N;
      if (keep && d.visibilityState !== 'hidden') requestAnimationFrame(frame); else running = false;
    }
    function kick() {
      if (running) return;
      running = true; last = performance.now();
      requestAnimationFrame(frame);
    }
    /* frame-cost counters for QA (read from the console as document.querySelector('.stage').rwStats) */
    stage.rwStats = stats;

    var rz;
    w.addEventListener('scroll', kick, { passive: true });
    w.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { measure(); kick(); }, 120); });
    d.addEventListener('visibilitychange', kick);
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(function () { measure(); kick(); });
    w.addEventListener('load', function () { measure(); kick(); });

    /* rail: jump to a step; smooth unless the user asked for less motion */
    for (var r = 0; r < rail.length; r++) {
      rail[r].addEventListener('click', function (e) {
        if (!isActive) return;
        e.preventDefault();
        var a = +this.getAttribute('data-go');
        var top = sec.offsetTop + START[a] * (sec.offsetHeight - w.innerHeight);
        w.scrollTo({ top: Math.round(top), behavior: 'smooth' });
      });
    }
    measure();
    kick();
  }
})();
