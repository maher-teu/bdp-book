/* The BDP Method - web reader */
const SUPABASE_URL = 'https://hsyknuzpbpxrbdplurlo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ZQX1vuget_zIt15MtTLC0w_4SDSaN-u';
const CTA_URL = 'https://calendar.app.google/FMKLkr5dQe6aHAyo8';
// Leave blank to serve images from this site's /img folder.
// Or paste a public folder URL (e.g. a Supabase Storage public bucket) ending in a slash.
const IMG_BASE = '';
const IMG_FALLBACK = 'https://hsyknuzpbpxrbdplurlo.supabase.co/storage/v1/object/public/book-images/';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
});

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
let BOOK = [];

let USER = null;
let IS_ADMIN = false;
let current = 0;
let progress = {};          // chapter_id -> {furthest_pct, completed, seconds_spent}
let highlights = [];        // rows for current chapter
let checklist = {};         // "chapter:index" -> bool
let pendingSel = null;
let secTimer = null, secCount = 0;

/* ---------------- toast ---------------- */
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ---------------- auth ---------------- */
async function init() {
  const { data } = await sb.auth.getSession();
  if (data.session) { await onSignedIn(data.session.user); }
  sb.auth.onAuthStateChange((_e, session) => {
    if (session && !USER) onSignedIn(session.user);
  });
}

$('#send-link').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  const name = $('#name').value.trim();
  const err = $('#gate-err');
  err.classList.add('hidden');
  if (!email || !email.includes('@')) { err.textContent = 'Enter a valid email address so we can send your link.'; err.classList.remove('hidden'); return; }
  const btn = $('#send-link'); btn.textContent = 'Sending...'; btn.disabled = true;
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname, data: { full_name: name } }
  });
  btn.textContent = 'Open my copy'; btn.disabled = false;
  if (error) { err.textContent = error.message; err.classList.remove('hidden'); return; }
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
  await sb.from('book_readers').upsert({ id: user.id, email: user.email, last_seen_at: new Date().toISOString() }, { onConflict: 'id' });
  const { data: adm } = await sb.from('book_admins').select('email');
  IS_ADMIN = !!(adm || []).find(a => (a.email || '').toLowerCase() === (user.email || '').toLowerCase());
  if (IS_ADMIN) { $('#admin-btn').classList.remove('hidden'); $('#upload-btn').classList.remove('hidden'); }
  if (!BOOK.length) {
    await loadBook();
    if (!BOOK.length) {
      if (IS_ADMIN) {
        $('#upload-modal').classList.remove('hidden');
        $('#up-txt').textContent = 'The book files are not uploaded yet. Drop them in and this becomes a live book.';
      } else {
        $('#page').innerHTML = '<p class="empty">This copy is being set up right now. Check back in a few minutes.</p>';
      }
      return;
    }
  }
  await loadProgress();
  await loadChecklist();
  buildChapterList();
  const resume = Object.keys(progress).length
    ? BOOK.findIndex(c => c.id === Object.entries(progress).sort((a, b) => new Date(b[1].updated_at || 0) - new Date(a[1].updated_at || 0))[0][0])
    : 0;
  openChapter(resume < 0 ? 0 : resume, true);
}

/* ---------------- data ---------------- */
async function loadProgress() {
  const { data } = await sb.from('book_progress').select('*').eq('user_id', USER.id);
  progress = {};
  (data || []).forEach(r => progress[r.chapter_id] = r);
}
async function loadChecklist() {
  const { data } = await sb.from('book_checklist').select('*').eq('user_id', USER.id);
  checklist = {};
  (data || []).forEach(r => checklist[r.chapter_id + ':' + r.step_index] = r.done);
}
async function loadHighlights(chapterId) {
  const { data } = await sb.from('book_highlights').select('*').eq('user_id', USER.id).eq('chapter_id', chapterId).order('created_at');
  highlights = data || [];
}
async function logEvent(event, chapter_id, meta) {
  sb.from('book_events').insert({ user_id: USER.id, event, chapter_id, meta: meta || null });
}

/* ---------------- chapter list ---------------- */
function pct(id) {
  const p = progress[id];
  return p ? Math.round((p.furthest_pct || 0) * 100) : 0;
}
function buildChapterList() {
  const ul = $('#chapter-list');
  ul.innerHTML = '';
  BOOK.forEach((c, i) => {
    const li = document.createElement('li');
    const p = pct(c.id);
    const state = p >= 92 ? 'done' : (p > 4 ? 'part' : '');
    li.innerHTML = `<button class="ch-btn ${i === current ? 'active' : ''}" data-i="${i}">
      <span class="ch-ring ${state}">${p >= 92 ? '&#10003;' : (p > 4 ? p : '')}</span>
      <span class="ch-name">${c.title}</span></button>`;
    li.querySelector('button').addEventListener('click', () => { closeDrawer(); openChapter(i); });
    ul.appendChild(li);
  });
  const vals = BOOK.map(c => Math.min(pct(c.id), 100));
  $('#overall-pct').textContent = Math.round(vals.reduce((a, b) => a + b, 0) / BOOK.length) + '%';
}

/* ---------------- render a chapter ---------------- */
async function openChapter(i, isResume) {
  current = i;
  const ch = BOOK[i];
  await loadHighlights(ch.id);
  const page = $('#page');
  page.innerHTML = ch.html;

  page.querySelectorAll('img').forEach(img => {
    img.loading = 'lazy';
    const rel = img.getAttribute('src');
    const file = rel.split('/').pop();
    let tried = 0;
    img.onerror = () => {
      tried++;
      if (tried === 1) { img.src = IMG_FALLBACK + rel; return; }
      if (tried === 2) { img.src = IMG_FALLBACK + file; return; }
      const w = img.closest('.imgw'); if (w) w.style.display = 'none';
    };
    img.src = rel;
  });
  transformSteps(page, ch.id);
  transformCTA(page);
  applyHighlights(page);
  indexBlocks(page);

  $('#bar-title').textContent = ch.title;
  $('#next-ch').style.display = i < BOOK.length - 1 ? 'block' : 'none';
  $('#pe-note').textContent = i < BOOK.length - 1 ? 'Up next: ' + BOOK[i + 1].title : 'That is the whole book. Now go and use it.';
  buildChapterList();

  const saved = progress[ch.id];
  window.scrollTo(0, 0);
  if (isResume && saved && saved.scroll_pct > 0.02 && saved.scroll_pct < 0.95) {
    setTimeout(() => {
      const max = document.body.scrollHeight - window.innerHeight;
      window.scrollTo({ top: max * saved.scroll_pct, behavior: 'instant' });
      toast('Picked up where you left off');
    }, 120);
  }
  logEvent('chapter_open', ch.id);
  startTimer();
  updateSpine();
}

function transformSteps(root, chapterId) {
  root.querySelectorAll('.step').forEach((el, idx) => {
    const key = chapterId + ':' + idx;
    if (checklist[key]) el.classList.add('done');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    const toggle = async () => {
      const now = !el.classList.contains('done');
      el.classList.toggle('done', now);
      checklist[key] = now;
      await sb.from('book_checklist').upsert(
        { user_id: USER.id, chapter_id: chapterId, step_index: idx, done: now, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,chapter_id,step_index' });
      if (now) { toast('Step done'); logEvent('step_done', chapterId, { step: idx }); }
    };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

function transformCTA(root) {
  root.querySelectorAll('.ctaline').forEach(el => {
    el.innerHTML = el.innerHTML.replace(/<b>Book it here:[^<]*<\/b>/i, '');
    const a = document.createElement('a');
    a.className = 'cta-btn'; a.href = CTA_URL; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'Book your free advisory session';
    a.addEventListener('click', () => logEvent('cta_click', BOOK[current].id));
    el.appendChild(a);
  });
}

function indexBlocks(root) {
  root.querySelectorAll('p,li,.pb,.dd,.st').forEach((el, i) => el.dataset.bi = i);
}

/* ---------------- highlighting ---------------- */
function applyHighlights(root) {
  const blocks = Array.from(root.querySelectorAll('p,li,.pb,.dd,.st'));
  highlights.forEach(h => {
    const el = blocks[h.block_index];
    if (!el) return;
    const idx = el.textContent.indexOf(h.quote);
    if (idx === -1) return;
    highlightRange(el, idx, h.quote.length, h);
  });
}
function highlightRange(el, start, len, row) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0, node, startNode = null, startOff = 0, endNode = null, endOff = 0;
  while ((node = walker.nextNode())) {
    const nlen = node.nodeValue.length;
    if (!startNode && pos + nlen > start) { startNode = node; startOff = start - pos; }
    if (startNode && pos + nlen >= start + len) { endNode = node; endOff = start + len - pos; break; }
    pos += nlen;
  }
  if (!startNode || !endNode) return;
  const range = document.createRange();
  range.setStart(startNode, startOff); range.setEnd(endNode, endOff);
  const mark = document.createElement('mark');
  mark.className = 'hl' + (row.note ? ' has-note' : '');
  mark.dataset.hid = row.id;
  if (row.note) mark.title = row.note;
  try { range.surroundContents(mark); } catch (e) { /* spans elements, skip */ }
  mark.addEventListener('click', (e) => { e.stopPropagation(); openNotesPanel(row.id); });
}

document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  const bar = $('#sel-bar');
  if (!sel || sel.isCollapsed || !sel.toString().trim() || sel.toString().trim().length < 4) { bar.classList.add('hidden'); return; }
  const anchor = sel.anchorNode && sel.anchorNode.parentElement;
  if (!anchor || !anchor.closest('#page')) { bar.classList.add('hidden'); return; }
  const block = anchor.closest('p,li,.pb,.dd,.st');
  if (!block) { bar.classList.add('hidden'); return; }
  pendingSel = { quote: sel.toString().trim(), block_index: parseInt(block.dataset.bi, 10) };
  const r = sel.getRangeAt(0).getBoundingClientRect();
  bar.classList.remove('hidden');
  const bw = 190;
  bar.style.left = Math.max(10, Math.min(window.innerWidth - bw - 10, r.left + r.width / 2 - bw / 2)) + 'px';
  bar.style.top = (r.top > 90 ? r.top - 54 : r.bottom + 12) + 'px';
});

$('#sel-bar').addEventListener('click', async (e) => {
  const act = e.target.dataset.act;
  if (!act || !pendingSel) return;
  if (act === 'highlight') { await saveHighlight(pendingSel, null); }
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
  const blocks = Array.from($('#page').querySelectorAll('p,li,.pb,.dd,.st'));
  const el = blocks[sel.block_index];
  if (el) { const i = el.textContent.indexOf(sel.quote); if (i > -1) highlightRange(el, i, sel.quote.length, data); }
  toast(note ? 'Note saved' : 'Highlighted');
  logEvent(note ? 'note_added' : 'highlight_added', BOOK[current].id);
}

/* ---------------- notes panel ---------------- */
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
    g.innerHTML = `<div class="nt-ch">${ch.title}</div>`;
    byCh[ch.id].forEach(r => {
      const d = document.createElement('div');
      d.className = 'nt-item';
      d.id = 'nt-' + r.id;
      d.innerHTML = `<div class="nt-quote">${escapeHtml(r.quote)}</div>
        ${r.note ? `<div class="nt-note">${escapeHtml(r.note)}</div>` : ''}
        <div class="nt-actions">
          <button data-go="${ch.id}">Go to it</button>
          <button data-del="${r.id}">Delete</button>
        </div>`;
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
    panel.classList.add('hidden');
    openChapter(i);
  }));
  if (focusId) { const el = $('#nt-' + focusId); if (el) el.scrollIntoView({ block: 'center' }); }
}
function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ---------------- scroll progress ---------------- */
let saveT;
function updateSpine() {
  const max = document.body.scrollHeight - window.innerHeight;
  const p = max > 0 ? Math.min(window.scrollY / max, 1) : 1;
  $('#spine-fill').style.height = (p * 100) + '%';
  return p;
}
window.addEventListener('scroll', () => {
  if (!USER || !BOOK[current]) return;
  const p = updateSpine();
  const id = BOOK[current].id;
  const prev = progress[id] || { furthest_pct: 0, seconds_spent: 0 };
  progress[id] = {
    ...prev,
    chapter_id: id,
    scroll_pct: p,
    furthest_pct: Math.max(prev.furthest_pct || 0, p),
    completed: (prev.completed || p > 0.93),
    updated_at: new Date().toISOString()
  };
  clearTimeout(saveT);
  saveT = setTimeout(saveProgress, 900);
}, { passive: true });

async function saveProgress() {
  const id = BOOK[current].id;
  const p = progress[id];
  if (!p) return;
  const wasComplete = p._sentComplete;
  await sb.from('book_progress').upsert({
    user_id: USER.id, chapter_id: id,
    scroll_pct: p.scroll_pct, furthest_pct: p.furthest_pct,
    completed: p.completed, seconds_spent: (p.seconds_spent || 0) + secCount,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,chapter_id' });
  p.seconds_spent = (p.seconds_spent || 0) + secCount;
  secCount = 0;
  if (p.completed && !wasComplete) { p._sentComplete = true; logEvent('chapter_complete', id); }
  buildChapterList();
}
function startTimer() {
  clearInterval(secTimer);
  secTimer = setInterval(() => { if (!document.hidden) secCount++; }, 1000);
}
window.addEventListener('beforeunload', () => { if (USER && BOOK[current]) saveProgress(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && USER) saveProgress(); });

$('#next-ch').addEventListener('click', () => { if (current < BOOK.length - 1) openChapter(current + 1); });

/* ---------------- drawer ---------------- */
function openDrawer() { $('#drawer').classList.add('open'); $('#scrim').classList.add('show'); }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#scrim').classList.remove('show'); }
$('#menu-btn').addEventListener('click', openDrawer);
$('#scrim').addEventListener('click', closeDrawer);
$$('[data-cta]').forEach(a => a.addEventListener('click', () => logEvent('cta_click', BOOK[current] ? BOOK[current].id : null, { where: a.dataset.cta })));

/* ---------------- admin dashboard ---------------- */
$('#admin-btn').addEventListener('click', openAdmin);
$('#admin-close').addEventListener('click', () => $('#admin-panel').classList.add('hidden'));

async function openAdmin() {
  const panel = $('#admin-panel'), body = $('#admin-body');
  body.innerHTML = '<p class="empty">Loading readers...</p>';
  panel.classList.remove('hidden');
  const { data: stats, error } = await sb.from('book_reader_stats').select('*').order('last_seen_at', { ascending: false });
  if (error) { body.innerHTML = '<p class="empty">Could not load the dashboard. Add your email to the book_admins table in Supabase.</p>'; return; }
  const rows = stats || [];
  const { data: prog } = await sb.from('book_progress').select('chapter_id, furthest_pct, completed');

  const readers = rows.length;
  const started = rows.filter(r => r.chapters_started > 0).length;
  const finishers = rows.filter(r => r.chapters_completed >= BOOK.length - 1).length;
  const avg = readers ? Math.round(rows.reduce((a, r) => a + Number(r.avg_pct || 0), 0) / readers) : 0;

  let html = `<div class="stat-row">
    <div class="stat"><div class="sv">${readers}</div><div class="sl2">Copies opened</div></div>
    <div class="stat"><div class="sv">${started}</div><div class="sl2">Started reading</div></div>
    <div class="stat"><div class="sv">${avg}%</div><div class="sl2">Average read</div></div>
    <div class="stat"><div class="sv">${finishers}</div><div class="sl2">Finished the book</div></div>
  </div>`;

  // drop off by chapter
  const byCh = {};
  (prog || []).forEach(p => {
    byCh[p.chapter_id] = byCh[p.chapter_id] || { started: 0, done: 0 };
    if (Number(p.furthest_pct) > 0.05) byCh[p.chapter_id].started++;
    if (p.completed) byCh[p.chapter_id].done++;
  });
  html += `<div class="nt-ch" style="margin:6px 0 10px">Where readers drop off</div><div class="tblwrap"><table class="adm"><tr><th>Chapter</th><th>Reached it</th><th>Finished it</th><th style="width:34%">Finish rate</th></tr>`;
  BOOK.forEach(c => {
    const s = byCh[c.id] || { started: 0, done: 0 };
    const rate = s.started ? Math.round(s.done / s.started * 100) : 0;
    html += `<tr><td>${c.title}</td><td>${s.started}</td><td>${s.done}</td>
      <td><div class="mini"><i style="width:${rate}%"></i></div><span style="font-size:11.5px;color:#6a6a7d">${rate}%</span></td></tr>`;
  });
  html += `</table></div>`;

  html += `<div class="nt-ch" style="margin:26px 0 10px">Every reader</div><div class="tblwrap"><table class="adm">
    <tr><th>Email</th><th>Progress</th><th>Last chapter</th><th>Steps done</th><th>Notes</th><th>Time</th><th>Last seen</th></tr>`;
  rows.forEach(r => {
    const ch = BOOK.find(c => c.id === r.last_chapter);
    const mins = Math.round((r.seconds_spent || 0) / 60);
    html += `<tr>
      <td>${escapeHtml(r.email || '')}</td>
      <td><div class="mini"><i style="width:${Math.min(Number(r.avg_pct || 0), 100)}%"></i></div><span style="font-size:11.5px;color:#6a6a7d">${r.avg_pct || 0}%</span></td>
      <td>${ch ? escapeHtml(ch.title) : '-'}</td>
      <td>${r.steps_done || 0}</td>
      <td>${r.highlight_count || 0}</td>
      <td>${mins}m</td>
      <td>${r.last_seen_at ? new Date(r.last_seen_at).toLocaleDateString() : ''}</td>
    </tr>`;
  });
  html += `</table></div>`;
  body.innerHTML = html;
}


async function loadBook() {
  try {
    const res = await fetch('book.json', { cache: 'no-cache' });
    if (res.ok) { BOOK = await res.json(); return true; }
  } catch (e) {}
  try {
    const res = await fetch(IMG_FALLBACK + 'book.json', { cache: 'no-cache' });
    if (res.ok) { BOOK = await res.json(); return true; }
  } catch (e) {}
  return false;
}

let MISSING_IMAGES = false;
function maybeOfferUpload() {
  if (!IS_ADMIN || !MISSING_IMAGES) return;
  const b = document.getElementById('upload-btn');
  if (b) b.classList.remove('hidden');
}

/* admin only: upload the illustrations straight from the browser */
async function uploadImages(files) {
  const bar = document.getElementById('up-bar');
  const txt = document.getElementById('up-txt');
  const all = Array.from(files);
  const list = all.filter(f => /\.(jpe?g|png|webp|json)$/i.test(f.name));
  if (!list.length) { txt.textContent = 'Those were not the right files. Open the download and drag everything inside the BDP_Book_Files folder.'; return; }
  let done = 0, failed = 0;
  for (const f of list) {
    const isJson = /\.json$/i.test(f.name);
    const path = isJson ? 'book.json' : 'img/' + f.name;
    const { error } = await sb.storage.from('book-images').upload(path, f, { upsert: true, contentType: isJson ? 'application/json' : (f.type || 'image/jpeg'), cacheControl: isJson ? '60' : '31536000' });
    if (error) failed++;
    done++;
    bar.style.width = Math.round(done / list.length * 100) + '%';
    txt.textContent = 'Uploading ' + done + ' of ' + list.length + '...';
  }
  txt.textContent = failed
    ? (done - failed) + ' uploaded, ' + failed + ' did not go through. Try dragging them again.'
    : 'All ' + done + ' files are live. Opening your book...';
  if (!failed) setTimeout(() => location.reload(), 1400);
}

function wireUploader() {
  const btn = document.getElementById('upload-btn');
  const modal = document.getElementById('upload-modal');
  const input = document.getElementById('up-input');
  const drop = document.getElementById('up-drop');
  if (!btn) return;
  btn.addEventListener('click', () => modal.classList.remove('hidden'));
  document.getElementById('up-close').addEventListener('click', () => modal.classList.add('hidden'));
  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', e => uploadImages(e.target.files));
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => {
    const items = e.dataTransfer.files;
    uploadImages(items);
  });
}

(async () => {
  await loadBook();
  wireUploader();
  init();
})();
