/* The BDP Method - web reader, paginated */
const SUPABASE_URL = 'https://hsyknuzpbpxrbdplurlo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ZQX1vuget_zIt15MtTLC0w_4SDSaN-u';
const CTA_URL = 'https://calendar.app.google/FMKLkr5dQe6aHAyo8';
const RESOURCE_LINKS = {
  'The Escape Calculator': 'https://docs.google.com/spreadsheets/d/1_KcYHQr35TUV-EbXNrBwgt18K-89muoybA4kgBdutpc/edit?usp=sharing',
  'The Life Design App': 'https://web-production-3b1d2.up.railway.app/',
  'Free CRM': 'https://docs.google.com/spreadsheets/d/1yTx98a8oGZERWmzbAK1PcCqX7Iluo7gHDHgCjPscDio/edit?usp=sharing',
  'The Hook Bank': 'https://docs.google.com/document/d/13z8gi9VC3ySOnn8ssX3N8ntHUTqA8lRY4KMd5u1BYaY/edit?usp=sharing',
  'The First Posts Pack': 'https://docs.google.com/document/d/1YODx1dSwdJw95Lfq4G8cX2bMrlyl63F9WlyD70Ly1qA/edit?usp=sharing',
  'The Daily Habit Tracker': 'https://docs.google.com/spreadsheets/d/1zI3fey-5nAxD2uI3eelq8Z5pqi6Cq5NJMXwfIs0YmZk/edit?usp=sharing',
  'Fathom': 'https://www.fathom.ai/'
};
const IMG_FALLBACK = 'https://hsyknuzpbpxrbdplurlo.supabase.co/storage/v1/object/public/book-images/';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
});

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let BOOK = [];
let USER = null, IS_ADMIN = false, PENDING = null;
let current = 0;
let progress = {}, highlights = [], checklist = {};
let pendingSel = null;
let secTimer = null, secCount = 0;
let page = 0, pages = 1, step = 0;
let saveT, relayoutT, rsT;

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), 2000);
}

/* ---------------- auth ---------------- */
async function init() {
  const { data } = await sb.auth.getSession();
  if (data.session) { await onSignedIn(data.session.user); }
  sb.auth.onAuthStateChange((_e, s) => { if (s && !USER) onSignedIn(s.user); });
}

$('#send-link').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  const name = $('#name').value.trim();
  const err = $('#gate-err');
  err.classList.add('hidden');
  if (!email || !email.includes('@')) { err.textContent = 'Enter your email so your progress and notes save to you.'; err.classList.remove('hidden'); return; }
  const btn = $('#send-link'); btn.textContent = 'Opening...'; btn.disabled = true;
  try { localStorage.setItem('bdp_email', email); localStorage.setItem('bdp_name', name); } catch (e) {}
  PENDING = { email: email, full_name: name };
  const { error } = await sb.auth.signInAnonymously();
  if (!error) { btn.textContent = 'Start reading'; btn.disabled = false; return; }
  const otp = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin, data: { full_name: name } } });
  btn.textContent = 'Start reading'; btn.disabled = false;
  if (otp.error) { err.textContent = otp.error.message; err.classList.remove('hidden'); return; }
  $('#sent-to').textContent = 'Sent to ' + email;
  $('#gate-step-email').classList.add('hidden');
  $('#gate-step-sent').classList.remove('hidden');
});
$('#email').addEventListener('keydown', e => { if (e.key === 'Enter') $('#send-link').click(); });
$('#back-to-email').addEventListener('click', () => {
  $('#gate-step-sent').classList.add('hidden');
  $('#gate-step-email').classList.remove('hidden');
});
$('#signout').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

async function onSignedIn(user) {
  USER = user;
  $('#gate').classList.add('hidden');
  $('#app').classList.remove('hidden');
  let mail = user.email || (PENDING && PENDING.email) || '';
  let nm = (PENDING && PENDING.full_name) || '';
  try { mail = mail || localStorage.getItem('bdp_email') || ''; nm = nm || localStorage.getItem('bdp_name') || ''; } catch (e) {}
  await sb.from('book_readers').upsert({ id: user.id, email: mail, full_name: nm, last_seen_at: new Date().toISOString() }, { onConflict: 'id' });
  const { data: adm } = await sb.from('book_admins').select('email');
  IS_ADMIN = !!(adm || []).find(a => (a.email || '').toLowerCase() === (mail || '').toLowerCase());
  if (IS_ADMIN) $('#admin-btn').classList.remove('hidden');
  if (!BOOK.length) await loadBook();
  if (!BOOK.length) { $('#flow').innerHTML = '<p class="empty">This copy is being set up. Check back shortly.</p>'; return; }
  await loadProgress();
  await loadChecklist();
  buildChapterList();
  let resume = 0;
  const seen = Object.entries(progress);
  if (seen.length) {
    seen.sort((a, b) => new Date(b[1].updated_at || 0) - new Date(a[1].updated_at || 0));
    const i = BOOK.findIndex(c => c.id === seen[0][0]);
    if (i > -1) resume = i;
  }
  openChapter(resume, true);
}

/* ---------------- data ---------------- */
async function loadBook() {
  try { const r = await fetch('book.json', { cache: 'no-cache' }); if (r.ok) { BOOK = await r.json(); return; } } catch (e) {}
  try { const r = await fetch(IMG_FALLBACK + 'book.json'); if (r.ok) { BOOK = await r.json(); } } catch (e) {}
}
async function loadProgress() {
  const { data } = await sb.from('book_progress').select('*').eq('user_id', USER.id);
  progress = {}; (data || []).forEach(r => progress[r.chapter_id] = r);
}
async function loadChecklist() {
  const { data } = await sb.from('book_checklist').select('*').eq('user_id', USER.id);
  checklist = {}; (data || []).forEach(r => checklist[r.chapter_id + ':' + r.step_index] = r.done);
}
async function loadHighlights(id) {
  const { data } = await sb.from('book_highlights').select('*').eq('user_id', USER.id).eq('chapter_id', id).order('created_at');
  highlights = data || [];
}
function logEvent(event, chapter_id, meta) {
  if (!USER) return;
  sb.from('book_events').insert({ user_id: USER.id, event, chapter_id, meta: meta || null });
}

/* ---------------- chapter menu ---------------- */
function pct(id) { const p = progress[id]; return p ? Math.round((p.furthest_pct || 0) * 100) : 0; }
function buildChapterList() {
  const ul = $('#chapter-list'); ul.innerHTML = '';
  BOOK.forEach((c, i) => {
    const p = pct(c.id);
    const state = p >= 92 ? 'done' : (p > 4 ? 'part' : '');
    const li = document.createElement('li');
    li.innerHTML = '<button class="ch-btn ' + (i === current ? 'active' : '') + '">' +
      '<span class="ch-ring ' + state + '">' + (p >= 92 ? '&#10003;' : (p > 4 ? p : '')) + '</span>' +
      '<span class="ch-name">' + c.title + '</span></button>';
    li.querySelector('button').addEventListener('click', () => { closeDrawer(); openChapter(i); });
    ul.appendChild(li);
  });
  const vals = BOOK.map(c => Math.min(pct(c.id), 100));
  $('#overall-pct').textContent = Math.round(vals.reduce((a, b) => a + b, 0) / BOOK.length) + '%';
}

/* ---------------- render and paginate ---------------- */
async function openChapter(i, isResume, toEnd) {
  current = i;
  const ch = BOOK[i];
  await loadHighlights(ch.id);
  const flow = $('#flow');
  flow.innerHTML = ch.html;
  flow.style.transform = 'translateX(0px)';

  flow.querySelectorAll('img').forEach(img => {
    const rel = img.getAttribute('src');
    const file = rel.split('/').pop();
    let tried = 0;
    img.onerror = () => {
      tried++;
      if (tried === 1) { img.src = file; return; }
      if (tried === 2) { img.src = IMG_FALLBACK + rel; return; }
      if (tried === 3) { img.src = IMG_FALLBACK + file; return; }
      const w = img.closest('.imgw'); if (w) w.style.display = 'none';
      relayoutSoon();
    };
    img.addEventListener('load', relayoutSoon);
    img.src = rel;
  });

  transformSteps(flow, ch.id);
  transformCTA(flow);
  wireContents(flow);
  applyHighlights(flow);
  indexBlocks(flow);

  $('#bar-title').textContent = ch.title;
  buildChapterList();
  layout();

  page = 0;
  const saved = progress[ch.id];
  if (toEnd) page = pages - 1;
  else if (isResume && saved && saved.scroll_pct > 0.01 && saved.scroll_pct < 0.99) {
    page = Math.min(pages - 1, Math.max(0, Math.round(saved.scroll_pct * (pages - 1))));
    if (page > 0) toast('Back where you left off');
  }
  goTo(page);
  logEvent('chapter_open', ch.id);
  startTimer();
}

function relayoutSoon() { clearTimeout(relayoutT); relayoutT = setTimeout(relayout, 80); }
function relayout() { const p = page; layout(); goTo(Math.min(p, pages - 1)); }

function layout() {
  const pager = $('#pager'), flow = $('#flow');
  const w = pager.clientWidth;
  const inner = Math.min(w - 48, 620);
  const gap = Math.max(48, w - inner);
  flow.style.width = inner + 'px';
  flow.style.left = Math.round((w - inner) / 2) + 'px';
  flow.style.columnWidth = inner + 'px';
  flow.style.columnGap = gap + 'px';
  step = inner + gap;
  document.documentElement.style.setProperty('--pageh', flow.clientHeight + 'px');
  pages = Math.max(1, Math.round(flow.scrollWidth / step));
  $('#pg-total').textContent = pages;
}

function goTo(i) {
  page = Math.max(0, Math.min(pages - 1, i));
  $('#flow').style.transform = 'translateX(' + (-page * step) + 'px)';
  $('#pg-now').textContent = page + 1;
  const p = pages > 1 ? page / (pages - 1) : 1;
  $('#spine-fill').style.height = (p * 100) + '%';
  $('#tap-prev').disabled = (page === 0 && current === 0);
  $('#tap-next').disabled = (page === pages - 1 && current === BOOK.length - 1);
  const last = page === pages - 1;
  const note = $('#end-note');
  note.classList.toggle('hidden', !last);
  if (last) {
    note.textContent = current < BOOK.length - 1
      ? 'Next: ' + BOOK[current + 1].title
      : 'That is the whole book. Now go and use it.';
  }
  markProgress(p);
}

function markProgress(p) {
  if (!USER || !BOOK[current]) return;
  const id = BOOK[current].id;
  const prev = progress[id] || { furthest_pct: 0, seconds_spent: 0 };
  progress[id] = Object.assign({}, prev, {
    chapter_id: id, scroll_pct: p,
    furthest_pct: Math.max(prev.furthest_pct || 0, p),
    completed: (prev.completed || p > 0.95),
    updated_at: new Date().toISOString()
  });
  clearTimeout(saveT);
  saveT = setTimeout(saveProgress, 800);
}
async function saveProgress() {
  if (!USER || !BOOK[current]) return;
  const id = BOOK[current].id, p = progress[id];
  if (!p) return;
  const was = p._done;
  await sb.from('book_progress').upsert({
    user_id: USER.id, chapter_id: id, scroll_pct: p.scroll_pct, furthest_pct: p.furthest_pct,
    completed: p.completed, seconds_spent: (p.seconds_spent || 0) + secCount, updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,chapter_id' });
  p.seconds_spent = (p.seconds_spent || 0) + secCount; secCount = 0;
  if (p.completed && !was) { p._done = true; logEvent('chapter_complete', id); }
  buildChapterList();
}
function startTimer() { clearInterval(secTimer); secTimer = setInterval(() => { if (!document.hidden) secCount++; }, 1000); }

/* ---------------- turning pages ---------------- */
function nextPage() {
  if (page < pages - 1) return goTo(page + 1);
  if (current < BOOK.length - 1) openChapter(current + 1);
}
function prevPage() {
  if (page > 0) return goTo(page - 1);
  if (current > 0) openChapter(current - 1, false, true);
}
$('#tap-prev').addEventListener('click', prevPage);
$('#tap-next').addEventListener('click', nextPage);
document.addEventListener('keydown', e => {
  if (!$('#gate').classList.contains('hidden')) return;
  if (!$('#note-modal').classList.contains('hidden')) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); nextPage(); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prevPage(); }
});
let touchX = null, touchY = null;
$('#pager').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
$('#pager').addEventListener('touchend', e => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  const dy = e.changedTouches[0].clientY - touchY;
  if (Math.abs(dx) > 38 && Math.abs(dx) > Math.abs(dy) * 1.2) { dx < 0 ? nextPage() : prevPage(); }
  touchX = null;
}, { passive: true });
window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(relayout, 200); });

/* ---------------- in page bits ---------------- */
function transformSteps(root, chapterId) {
  root.querySelectorAll('.step').forEach((el, idx) => {
    const key = chapterId + ':' + idx;
    if (checklist[key]) el.classList.add('done');
    el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
    const toggle = async (e) => {
      if (e) e.stopPropagation();
      const now = !el.classList.contains('done');
      el.classList.toggle('done', now);
      checklist[key] = now;
      await sb.from('book_checklist').upsert(
        { user_id: USER.id, chapter_id: chapterId, step_index: idx, done: now, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,chapter_id,step_index' });
      if (now) { toast('Step done'); logEvent('step_done', chapterId, { step: idx }); }
    };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); toggle(e); } });
  });
}
function transformCTA(root) {
  root.querySelectorAll('.resbox').forEach(box => {
    box.querySelectorAll('.rn').forEach(nameEl => {
      const url = RESOURCE_LINKS[nameEl.textContent.trim()];
      if (!url) return;
      const a = document.createElement('a');
      a.className = 'reslink'; a.href = url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = 'Open it';
      a.addEventListener('click', e => { e.stopPropagation(); logEvent('resource_click', BOOK[current].id, { name: nameEl.textContent.trim() }); });
      (nameEl.parentElement.classList.contains('ritem') ? nameEl.parentElement : box).appendChild(a);
    });
    const line = box.querySelector('.ctaline');
    if (!line) return;
    line.remove();
    line.innerHTML = line.innerHTML.replace(/<span class="lnk"[^>]*>.*?<\/span>/i, '')
      .replace(/<b>Book it here[^<]*<\/b>/i, '');
    const gift = document.createElement('div');
    gift.className = 'giftbox';
    gift.innerHTML = '<div class="gifthead">' +
      '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">' +
      '<path fill="currentColor" d="M20 7h-2.2a3 3 0 0 0-.5-3.5A3 3 0 0 0 12 4a3 3 0 0 0-5.3-.5A3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3h9V8h0v3h9V8a1 1 0 0 0-1-1Zm-6.6-2a1 1 0 1 1 1.4 1.4c-.4.4-1.2.5-2 .6.1-.8.2-1.6.6-2ZM8.6 5a1 1 0 0 1 1.4 0c.4.4.5 1.2.6 2-.8-.1-1.6-.2-2-.6A1 1 0 0 1 8.6 5ZM4 13v7a1 1 0 0 0 1 1h6v-8H4Zm9 8h6a1 1 0 0 0 1-1v-7h-7v8Z"/></svg>' +
      '<span>Collect your free gift</span></div>';
    gift.appendChild(line);
    const a = document.createElement('a');
    a.className = 'cta-btn'; a.href = CTA_URL; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'Book your free advisory session';
    a.addEventListener('click', e => { e.stopPropagation(); logEvent('cta_click', BOOK[current].id); });
    gift.appendChild(a);
    box.parentElement.insertBefore(gift, box.nextSibling);
  });
}

function indexBlocks(root) { root.querySelectorAll('p,li,.pb,.dd,.st').forEach((el, i) => el.dataset.bi = i); }

/* ---------------- highlights ---------------- */
function applyHighlights(root) {
  const blocks = Array.from(root.querySelectorAll('p,li,.pb,.dd,.st'));
  highlights.forEach(h => {
    const el = blocks[h.block_index]; if (!el) return;
    const i = el.textContent.indexOf(h.quote); if (i === -1) return;
    highlightRange(el, i, h.quote.length, h);
  });
}
function highlightRange(el, start, len, row) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0, node, sN = null, sO = 0, eN = null, eO = 0;
  while ((node = walker.nextNode())) {
    const n = node.nodeValue.length;
    if (!sN && pos + n > start) { sN = node; sO = start - pos; }
    if (sN && pos + n >= start + len) { eN = node; eO = start + len - pos; break; }
    pos += n;
  }
  if (!sN || !eN) return;
  const r = document.createRange();
  r.setStart(sN, sO); r.setEnd(eN, eO);
  const mark = document.createElement('mark');
  mark.className = 'hl' + (row.note ? ' has-note' : '');
  if (row.note) mark.title = row.note;
  try { r.surroundContents(mark); } catch (e) { return; }
  mark.addEventListener('click', e => { e.stopPropagation(); openNotesPanel(row.id); });
}
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection(); const bar = $('#sel-bar');
  if (!sel || sel.isCollapsed || sel.toString().trim().length < 4) { bar.classList.add('hidden'); return; }
  const a = sel.anchorNode && sel.anchorNode.parentElement;
  if (!a || !a.closest('#flow')) { bar.classList.add('hidden'); return; }
  const block = a.closest('p,li,.pb,.dd,.st');
  if (!block) { bar.classList.add('hidden'); return; }
  pendingSel = { quote: sel.toString().trim(), block_index: parseInt(block.dataset.bi, 10) };
  const r = sel.getRangeAt(0).getBoundingClientRect();
  bar.classList.remove('hidden');
  const bw = 190;
  bar.style.left = Math.max(10, Math.min(window.innerWidth - bw - 10, r.left + r.width / 2 - bw / 2)) + 'px';
  bar.style.top = (r.top > 100 ? r.top - 54 : r.bottom + 12) + 'px';
});
$('#sel-bar').addEventListener('click', async (e) => {
  e.stopPropagation();
  const act = e.target.dataset.act;
  if (!act || !pendingSel) return;
  if (act === 'highlight') await saveHighlight(pendingSel, null);
  else {
    $('#note-quote').textContent = pendingSel.quote;
    $('#note-text').value = '';
    $('#note-modal').classList.remove('hidden');
    setTimeout(() => $('#note-text').focus(), 60);
  }
  $('#sel-bar').classList.add('hidden');
  window.getSelection().removeAllRanges();
});
$('#note-cancel').addEventListener('click', () => $('#note-modal').classList.add('hidden'));
$('#note-save').addEventListener('click', async () => {
  await saveHighlight(pendingSel, $('#note-text').value.trim() || null);
  $('#note-modal').classList.add('hidden');
});
async function saveHighlight(sel, note) {
  const row = { user_id: USER.id, chapter_id: BOOK[current].id, block_index: sel.block_index, quote: sel.quote, note };
  const { data, error } = await sb.from('book_highlights').insert(row).select().single();
  if (error) { toast('Could not save that one'); return; }
  highlights.push(data);
  const blocks = Array.from($('#flow').querySelectorAll('p,li,.pb,.dd,.st'));
  const el = blocks[sel.block_index];
  if (el) { const i = el.textContent.indexOf(sel.quote); if (i > -1) highlightRange(el, i, sel.quote.length, data); }
  toast(note ? 'Note saved' : 'Highlighted');
  logEvent(note ? 'note_added' : 'highlight_added', BOOK[current].id);
}

/* ---------------- notes ---------------- */
$('#notes-btn').addEventListener('click', () => openNotesPanel());
$('#notes-close').addEventListener('click', () => $('#notes-panel').classList.add('hidden'));
async function openNotesPanel(focusId) {
  const panel = $('#notes-panel'), body = $('#notes-body');
  body.innerHTML = '<p class="empty">Loading your notes...</p>';
  panel.classList.remove('hidden');
  const { data } = await sb.from('book_highlights').select('*').eq('user_id', USER.id).order('created_at', { ascending: false });
  const rows = data || [];
  if (!rows.length) {
    body.innerHTML = '<p class="empty">Nothing saved yet.<br><br>Select any sentence while you read to highlight it or attach a note. Everything you save lands here.</p>';
    return;
  }
  const byCh = {};
  rows.forEach(r => { (byCh[r.chapter_id] = byCh[r.chapter_id] || []).push(r); });
  body.innerHTML = '';
  BOOK.forEach(ch => {
    if (!byCh[ch.id]) return;
    const g = document.createElement('div');
    g.className = 'nt-group';
    g.innerHTML = '<div class="nt-ch">' + ch.title + '</div>';
    byCh[ch.id].forEach(r => {
      const d = document.createElement('div');
      d.className = 'nt-item'; d.id = 'nt-' + r.id;
      d.innerHTML = '<div class="nt-quote">' + escapeHtml(r.quote) + '</div>' +
        (r.note ? '<div class="nt-note">' + escapeHtml(r.note) + '</div>' : '') +
        '<div class="nt-actions"><button data-go="' + ch.id + '">Go to it</button>' +
        '<button data-del="' + r.id + '">Delete</button></div>';
      g.appendChild(d);
    });
    body.appendChild(g);
  });
  body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    await sb.from('book_highlights').delete().eq('id', b.dataset.del);
    openNotesPanel();
    if (BOOK[current]) { await loadHighlights(BOOK[current].id); openChapter(current); }
  }));
  body.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
    const i = BOOK.findIndex(c => c.id === b.dataset.go);
    panel.classList.add('hidden'); openChapter(i);
  }));
  if (focusId) { const el = $('#nt-' + focusId); if (el) el.scrollIntoView({ block: 'center' }); }
}
function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ---------------- drawer ---------------- */
function openDrawer() { $('#drawer').classList.add('open'); $('#scrim').classList.add('show'); }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#scrim').classList.remove('show'); }
$('#menu-btn').addEventListener('click', openDrawer);
$('#scrim').addEventListener('click', closeDrawer);
$$('[data-cta]').forEach(a => a.addEventListener('click', () => logEvent('cta_click', BOOK[current] ? BOOK[current].id : null, { where: a.dataset.cta })));
window.addEventListener('beforeunload', saveProgress);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(); });

/* ---------------- dashboard ---------------- */
$('#admin-btn').addEventListener('click', openAdmin);
$('#admin-close').addEventListener('click', () => $('#admin-panel').classList.add('hidden'));
async function openAdmin() {
  const panel = $('#admin-panel'), body = $('#admin-body');
  body.innerHTML = '<p class="empty">Loading readers...</p>';
  panel.classList.remove('hidden');
  const { data: stats, error } = await sb.from('book_reader_stats').select('*').order('last_seen_at', { ascending: false });
  if (error) { body.innerHTML = '<p class="empty">Could not load the dashboard.</p>'; return; }
  const rows = stats || [];
  const { data: prog } = await sb.from('book_progress').select('chapter_id, furthest_pct, completed');
  const readers = rows.length;
  const started = rows.filter(r => r.chapters_started > 0).length;
  const finishers = rows.filter(r => r.chapters_completed >= BOOK.length - 1).length;
  const avg = readers ? Math.round(rows.reduce((a, r) => a + Number(r.avg_pct || 0), 0) / readers) : 0;
  let html = '<div class="stat-row">' +
    '<div class="stat"><div class="sv">' + readers + '</div><div class="sl2">Copies opened</div></div>' +
    '<div class="stat"><div class="sv">' + started + '</div><div class="sl2">Started reading</div></div>' +
    '<div class="stat"><div class="sv">' + avg + '%</div><div class="sl2">Average read</div></div>' +
    '<div class="stat"><div class="sv">' + finishers + '</div><div class="sl2">Finished the book</div></div></div>';
  const byCh = {};
  (prog || []).forEach(p => {
    byCh[p.chapter_id] = byCh[p.chapter_id] || { started: 0, done: 0 };
    if (Number(p.furthest_pct) > 0.05) byCh[p.chapter_id].started++;
    if (p.completed) byCh[p.chapter_id].done++;
  });
  html += '<div class="nt-ch" style="margin:6px 0 10px">Where readers drop off</div><div class="tblwrap"><table class="adm"><tr><th>Chapter</th><th>Reached it</th><th>Finished it</th><th style="width:34%">Finish rate</th></tr>';
  BOOK.forEach(c => {
    const s = byCh[c.id] || { started: 0, done: 0 };
    const rate = s.started ? Math.round(s.done / s.started * 100) : 0;
    html += '<tr><td>' + c.title + '</td><td>' + s.started + '</td><td>' + s.done + '</td>' +
      '<td><div class="mini"><i style="width:' + rate + '%"></i></div><span style="font-size:11.5px;color:#6a6a7d">' + rate + '%</span></td></tr>';
  });
  html += '</table></div><div class="nt-ch" style="margin:26px 0 10px">Every reader</div><div class="tblwrap"><table class="adm">' +
    '<tr><th>Email</th><th>Progress</th><th>Last chapter</th><th>Steps done</th><th>Notes</th><th>Time</th><th>Last seen</th></tr>';
  rows.forEach(r => {
    const ch = BOOK.find(c => c.id === r.last_chapter);
    const mins = Math.round((r.seconds_spent || 0) / 60);
    html += '<tr><td>' + escapeHtml(r.email || '') + '</td>' +
      '<td><div class="mini"><i style="width:' + Math.min(Number(r.avg_pct || 0), 100) + '%"></i></div><span style="font-size:11.5px;color:#6a6a7d">' + (r.avg_pct || 0) + '%</span></td>' +
      '<td>' + (ch ? escapeHtml(ch.title) : '-') + '</td><td>' + (r.steps_done || 0) + '</td><td>' + (r.highlight_count || 0) + '</td>' +
      '<td>' + mins + 'm</td><td>' + (r.last_seen_at ? new Date(r.last_seen_at).toLocaleDateString() : '') + '</td></tr>';
  });
  html += '</table></div>';
  body.innerHTML = html;
}

(async () => { await loadBook(); init(); })();
