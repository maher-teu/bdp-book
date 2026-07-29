/* The BDP Method - resources add-on.
   Self contained. Does not modify the reader engine, pagination, or book content.
   It wraps transformCTA so the buttons exist BEFORE pages are measured. */
(function () {
  'use strict';

  // Keyed by the resource name exactly as it appears in book.json today.
  // "as" renames what the reader sees, so the book matches the real file names.
  var RES = {
    'The BDP Roadmap':        { url: 'resources/bdp-roadmap.pdf',          kind: 'pdf' },
    'Find A Problem':         { url: 'resources/problem-finder.pdf',       kind: 'pdf',  as: 'The Problem Finder' },
    'Build Your Offer':       { url: 'resources/offer-builder.pdf',        kind: 'pdf',  as: 'The Offer Builder' },
    'Proven Scripts':         { url: 'resources/script-pack.pdf',          kind: 'pdf',  as: 'The Script Pack' },
    'The Full Intro Call Script': { url: 'resources/intro-call-framework.pdf', kind: 'pdf', as: 'The 7-Figure Intro Call' },
    'The Intro Call Compass': { url: 'resources/call-compass.html',        kind: 'page', as: 'The Call Compass' },
    'The Demo Call Template': { url: 'resources/demo-call-deck.pptx',      kind: 'file', as: 'The Demo Call Deck' },
    'Onboarding Your Clients':{ url: 'resources/first-48-hours.pdf',       kind: 'pdf',  as: 'The First 48 Hours' }
  };
  var LABEL = { pdf: 'Open it', page: 'Open it', file: 'Download it' };

  /* ---------- styles, injected so no stylesheet is edited ---------- */
  var css = document.createElement('style');
  css.textContent = [
    '.res-ov{position:fixed;inset:0;z-index:120;background:#FBF9F3;display:flex;flex-direction:column;padding-top:env(safe-area-inset-top)}',
    '.res-ov.hidden{display:none}',
    '.res-ov .rh{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #e2ddcd;background:#12121f}',
    '.res-ov .rt{flex:1;min-width:0;color:#fff;font-family:"Space Grotesk",sans-serif;font-weight:700;font-size:14px;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.res-ov .rb{flex:0 0 auto;font-family:"Space Grotesk",sans-serif;font-weight:700;font-size:13px;',
    'padding:8px 12px;border-radius:8px;text-decoration:none;border:1px solid #3a3a52;color:#c9c8d6}',
    '.res-ov .rb.gold{background:#F5B942;color:#12121f;border-color:#F5B942}',
    '.res-ov .rx{flex:0 0 auto;background:none;border:none;color:#c9c8d6;font-size:26px;line-height:1;padding:0 6px;cursor:pointer}',
    '.res-ov iframe{flex:1;width:100%;border:none;background:#fff}',
    '.res-ov .rnote{padding:26px 20px;text-align:center;color:#6a6a7d;font-family:"Space Grotesk",sans-serif;font-size:14px;line-height:1.6}',
    'a.reslink{display:inline-block;margin-top:8px;background:#F5B942;color:#12121f;font-family:"Space Grotesk",sans-serif;',
    'font-weight:700;font-size:13px;padding:7px 14px;border-radius:8px;text-decoration:none}'
  ].join('');
  document.head.appendChild(css);

  /* ---------- the preview overlay ---------- */
  var ov = null;
  function overlay() {
    if (ov) return ov;
    ov = document.createElement('div');
    ov.className = 'res-ov hidden';
    ov.innerHTML =
      '<div class="rh">' +
        '<div class="rt"></div>' +
        '<a class="rb" target="_blank" rel="noopener">Open in tab</a>' +
        '<a class="rb gold" download>Download</a>' +
        '<button class="rx" aria-label="Close">&times;</button>' +
      '</div><iframe title="Resource"></iframe>';
    ov.querySelector('.rx').addEventListener('click', close);
    document.body.appendChild(ov);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !ov.classList.contains('hidden')) close();
    });
    return ov;
  }
  function close() {
    if (!ov) return;
    ov.classList.add('hidden');
    var f = ov.querySelector('iframe');
    if (f) f.src = 'about:blank';
  }
  function open(name, res) {
    var o = overlay();
    o.querySelector('.rt').textContent = name;
    var links = o.querySelectorAll('.rb');
    links[0].href = res.url;
    links[1].href = res.url;
    o.querySelector('iframe').src = res.url;
    o.classList.remove('hidden');
  }

  /* ---------- decorate the resource boxes ---------- */
  function log(name) {
    try {
      if (typeof sb === 'undefined' || typeof USER === 'undefined' || !USER) return;
      var id = (typeof BOOK !== 'undefined' && BOOK[current]) ? BOOK[current].id : null;
      sb.from('book_events').insert({ user_id: USER.id, event: 'resource_click', chapter_id: id, meta: { name: name } });
    } catch (e) {}
  }

  function decorate(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.resbox .rn').forEach(function (nameEl) {
      var raw = (nameEl.textContent || '').trim();
      var res = RES[raw];
      if (!res) return;
      var holder = nameEl.parentElement && nameEl.parentElement.classList.contains('ritem')
        ? nameEl.parentElement : nameEl.closest('.resbox');
      if (!holder || holder.querySelector('a.reslink')) return;   // engine already handled it
      if (res.as) nameEl.textContent = res.as;
      var label = res.as || raw;
      var a = document.createElement('a');
      a.className = 'reslink';
      a.textContent = LABEL[res.kind] || 'Open it';
      a.href = res.url;
      if (res.kind === 'file') { a.setAttribute('download', ''); }
      a.addEventListener('click', function (e) {
        e.stopPropagation();
        log(label);
        if (res.kind === 'pdf' || res.kind === 'page') { e.preventDefault(); open(label, res); }
      });
      holder.appendChild(a);
    });
  }

  /* ---------- hook in before pagination measures anything ---------- */
  var original = window.transformCTA;
  if (typeof original === 'function') {
    window.transformCTA = function (root) {
      var out = original.apply(this, arguments);
      try { decorate(root); } catch (e) { console.error('resources add-on', e); }
      return out;
    };
  } else {
    // engine loaded differently: decorate whatever lands in the reader instead
    var flow = document.getElementById('flow');
    if (flow && window.MutationObserver) {
      new MutationObserver(function () { decorate(flow); }).observe(flow, { childList: true });
    }
  }
})();
