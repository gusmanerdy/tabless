import { getDuplicateCandidates, isProtected, isSafeUrl, findStaleTabs, hostname, canonicalUrl } from './lib/model.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = { tabs: [], sessions: [], settings: { staleDays: 7 }, view: 'live', filter: 'duplicates', search: '', selected: new Set(), expanded: new Set(), busy: false, loading: true };
const previewMode = !globalThis.chrome?.runtime?.id;
let previewTransport;
let refreshTimer;
let toastTimer;
let undoAction;
let requestNumber = 0;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function iconButton(name, label, action) {
  const button = element('button', 'icon-button');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(icon(name));
  button.addEventListener('click', action);
  return button;
}

async function send(type, payload = {}) {
  if (previewMode && !previewTransport) previewTransport = (await import('./preview.js')).sendMessage;
  const response = previewMode
    ? await previewTransport({ type, ...payload })
    : await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || 'Permintaan belum berhasil. Coba lagi.');
  return response.data;
}

function duplicates() { return getDuplicateCandidates(state.tabs); }
function stale() { return findStaleTabs(state.tabs, state.settings.staleDays); }
function candidates() {
  if (state.filter === 'duplicates') return duplicates();
  if (state.filter === 'stale') return stale();
  return state.tabs;
}
function matches(tab) {
  return `${tab.title || ''} ${tab.url || ''}`.toLocaleLowerCase('id').includes(state.search.toLocaleLowerCase('id'));
}
function visibleTabs() { return candidates().filter(matches); }
function eligibleTabs() { return candidates().filter((tab) => !isProtected(tab)); }

function dateLabel(timestamp) {
  if (!timestamp) return 'Waktu tidak diketahui';
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(timestamp);
}

function ageLabel(timestamp) {
  if (!timestamp || !Number.isFinite(timestamp)) return 'Belum diketahui';
  const age = Math.max(0, Date.now() - timestamp);
  const days = Math.floor(age / 86400000);
  if (days > 0) return `${days} hari lalu`;
  const hours = Math.floor(age / 3600000);
  if (hours > 0) return `${hours} jam lalu`;
  return 'Baru saja';
}

function siteIcon(url) {
  const domain = hostname(url) || 'web';
  const node = element('span', 'site-icon', domain.replace(/^www\./, '').charAt(0).toUpperCase());
  node.setAttribute('aria-hidden', 'true');
  node.dataset.color = String([...domain].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4);
  return node;
}

function showToast(message, action) {
  clearTimeout(toastTimer);
  $('#toast-message').textContent = message;
  $('#toast').hidden = false;
  $('#toast-action').hidden = !action;
  undoAction = action;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; undoAction = undefined; }, action ? 15000 : 6500);
}

function showError(error) {
  $('#error-banner').textContent = error?.message || String(error);
  $('#error-banner').hidden = false;
}

function setBusy(busy) {
  state.busy = busy;
  document.body.classList.toggle('busy', busy);
  document.body.setAttribute('aria-busy', String(busy));
  $('#archive-button').disabled = busy || state.selected.size === 0;
}

async function refresh() {
  const currentRequest = ++requestNumber;
  try {
    const data = await send('GET_STATE');
    if (currentRequest !== requestNumber) return;
    state.tabs = data.tabs.filter((tab) => isSafeUrl(tab.url));
    state.sessions = data.sessions;
    state.settings = data.settings;
    state.loading = false;
    $('#error-banner').hidden = true;
    const eligible = new Set(eligibleTabs().map((tab) => tab.id));
    state.selected = new Set([...state.selected].filter((id) => eligible.has(id)));
    render();
  } catch (error) {
    state.loading = false;
    render();
    showError(error);
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if (!state.busy) refresh(); }, 250);
}

async function mutate(type, payload, onSuccess) {
  if (state.busy) return;
  setBusy(true);
  try {
    const data = await send(type, payload);
    await refresh();
    if (onSuccess) onSuccess(data);
  } catch (error) {
    showError(error);
    showToast(error.message);
    await refresh();
    showError(error);
  } finally {
    setBusy(false);
  }
}

function dialog({ title, description, confirm, name, note = false, danger = false }) {
  return new Promise((resolve) => {
    const node = $('#action-dialog');
    $('#dialog-title').textContent = title;
    $('#dialog-description').textContent = description;
    $('#dialog-confirm').textContent = confirm;
    $('#dialog-confirm').classList.toggle('danger', danger);
    $('#dialog-input-label').hidden = name === undefined;
    $('#dialog-input').value = name || '';
    $('#dialog-input').required = name !== undefined;
    $('#dialog-note').hidden = !note;
    node.returnValue = 'cancel';
    node.addEventListener('close', () => resolve(node.returnValue === 'confirm' ? { name: $('#dialog-input').value.trim() } : null), { once: true });
    node.showModal();
    if (name !== undefined) { $('#dialog-input').focus(); $('#dialog-input').select(); }
    else $('#dialog-confirm').focus();
  });
}

async function archiveSelected() {
  const tabs = eligibleTabs().filter((tab) => state.selected.has(tab.id));
  if (!tabs.length || state.busy) return;
  const source = state.filter === 'duplicates' ? 'duplicates' : state.filter === 'stale' ? 'stale' : 'manual';
  const prefix = source === 'duplicates' ? 'Duplikat' : source === 'stale' ? 'Tab lama' : 'Koleksi';
  const answer = await dialog({
    title: 'Simpan dulu, lalu beri ruang.',
    description: `${tabs.length} tab akan disimpan dalam koleksi, lalu ditutup. Kamu bisa membuka tautannya kembali kapan saja.`,
    confirm: `Simpan & tutup ${tabs.length} tab`,
    name: `${prefix} · ${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(new Date())}`,
    note: true,
  });
  if (!answer) return;
  await mutate('ARCHIVE_TABS', {
    tabs: tabs.map(({ id, url, lastAccessed }) => ({ id, url, lastAccessed })),
    source,
    name: answer.name || prefix,
  }, (data) => {
    state.selected.clear();
    render();
    const skipped = data.skippedCount ? ` ${data.skippedCount} tab dilewati karena kondisinya berubah.` : '';
    showToast(`${data.savedCount} tautan tersimpan. ${data.closedCount} tab ditutup.${skipped}`);
  });
}

async function focusTab(tab) {
  if (previewMode) { showToast(`Pratinjau: beralih ke ${hostname(tab.url)}.`); return; }
  try {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch { showToast('Tab ini sudah berubah atau ditutup. Daftar diperbarui.'); await refresh(); }
}

function tabRow(tab, session) {
  const row = element('div', 'tab-row');
  const saved = Boolean(session);
  if (!saved) {
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selected.has(tab.id);
    checkbox.disabled = isProtected(tab);
    checkbox.setAttribute('aria-label', `Pilih ${tab.title || hostname(tab.url)}`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selected.add(tab.id); else state.selected.delete(tab.id);
      row.classList.toggle('selected', checkbox.checked);
      renderSelection();
    });
    row.append(checkbox);
    row.classList.toggle('selected', checkbox.checked);
  }
  row.append(siteIcon(tab.url));
  const text = element('div', 'tab-text');
  const title = element('button', 'tab-title', tab.title || hostname(tab.url));
  title.type = 'button';
  title.title = tab.url;
  const open = () => saved
    ? mutate('OPEN_SAVED_TAB', { sessionId: session.id, tabId: tab.id }, () => showToast('Tautan dibuka di tab baru.'))
    : focusTab(tab);
  title.addEventListener('click', open);
  const meta = element('div', 'tab-meta');
  meta.append(element('span', 'tab-domain', hostname(tab.url)));
  if (!saved && state.filter === 'duplicates') {
    const copies = state.tabs.filter((item) => canonicalUrl(item.url) === canonicalUrl(tab.url)).length;
    meta.append(element('span', 'meta-dot', '·'), element('span', '', `${copies} salinan terbuka`));
  }
  if (!saved && state.filter === 'all') {
    meta.append(element('span', 'meta-dot', '·'), element('span', '', `Jendela ${windowNumber(tab.windowId)}`));
  }
  text.append(title, meta);
  row.append(text);
  if (!saved) {
    const badges = element('div', 'row-badges');
    if (tab.active) badges.append(element('span', 'badge', 'Aktif'));
    if (tab.pinned) badges.append(element('span', 'badge', 'Dipin'));
    if (tab.audible) badges.append(element('span', 'badge', 'Bersuara'));
    if (tab.pendingUrl || tab.status === 'loading') badges.append(element('span', 'badge', 'Memuat'));
    row.append(badges);
    const age = element('span', 'row-time', ageLabel(tab.lastAccessed));
    age.title = tab.lastAccessed ? `Terakhir dipakai: ${new Date(tab.lastAccessed).toLocaleString('id-ID')}` : 'Waktu pemakaian terakhir belum tersedia.';
    row.append(age);
  }
  const openButton = iconButton('external', saved ? 'Buka tautan di tab baru' : 'Beralih ke tab ini', open);
  openButton.classList.add('row-open');
  row.append(openButton);
  return row;
}

function windowNumber(id) {
  return [...new Set(state.tabs.map((tab) => tab.windowId))].indexOf(id) + 1;
}

function emptyState(name, title, description) {
  const node = element('div', 'empty-state');
  const symbol = element('span', 'empty-icon');
  symbol.append(icon(name));
  node.append(symbol, element('h3', '', title), element('p', '', description));
  return node;
}

function renderLive() {
  const list = $('#list');
  list.replaceChildren();
  const tabs = visibleTabs();
  if (state.loading) {
    const loading = element('div', 'loading-state');
    loading.append(element('span', 'spinner'), document.createTextNode('Menyiapkan ruangmu…'));
    list.append(loading);
    return;
  }
  if (!tabs.length) {
    if (state.search) list.append(emptyState('search', 'Belum ada yang cocok.', 'Coba judul lain atau nama situs yang lebih singkat.'));
    else if (state.filter === 'duplicates') list.append(emptyState('check', 'Tidak ada duplikat yang perlu dirapikan.', 'Satu tab untuk setiap tautan. Tab aktif, dipin, dan bersuara tetap dijaga.'));
    else if (state.filter === 'stale') list.append(emptyState('clock', 'Semua masih relevan.', `Belum ada tab yang tidak dipakai selama ${state.settings.staleDays} hari dan aman untuk dirapikan.`));
    else list.append(emptyState('tabs', 'Ruangmu sudah lapang.', 'Tab web yang terbuka akan muncul di sini. Halaman internal Chrome dan tab samaran tidak ditampilkan.'));
    return;
  }
  const fragment = document.createDocumentFragment();
  tabs.forEach((tab) => fragment.append(tabRow(tab)));
  list.append(fragment);
}

function sessionCard(session) {
  const card = element('article', 'session-card');
  const heading = element('div', 'session-heading');
  const toggle = element('button', 'session-toggle');
  const expanded = state.expanded.has(session.id) || Boolean(state.search);
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', `${expanded ? 'Tutup' : 'Lihat'} koleksi ${session.name}`);
  const symbol = element('span', 'session-symbol');
  symbol.append(icon('folder'));
  const text = element('span');
  text.append(element('span', 'session-title', session.name), element('span', 'session-meta', `${session.tabs.length} tautan · ${dateLabel(session.createdAt)}`));
  toggle.append(icon('chevron'), symbol, text);
  toggle.addEventListener('click', () => { if (state.expanded.has(session.id)) state.expanded.delete(session.id); else state.expanded.add(session.id); renderSaved(); });
  heading.append(toggle);
  const actions = element('div', 'session-actions');
  const restore = element('button', 'button secondary', 'Buka semua');
  restore.type = 'button';
  restore.append(icon('external'));
  restore.addEventListener('click', async () => {
    const answer = await dialog({ title: 'Lanjutkan koleksimu?', description: `${session.tabs.length} tautan akan dibuka kembali di jendela baru. Koleksi tetap tersimpan.`, confirm: 'Buka semua' });
    if (answer) mutate('RESTORE_SESSION', { id: session.id }, (data) => showToast(`${data.openedCount} tab dibuka.${data.failedCount ? ` ${data.failedCount} tautan belum berhasil dibuka.` : ''}`));
  });
  const rename = iconButton('edit', `Ubah nama ${session.name}`, async () => {
    const answer = await dialog({ title: 'Beri nama yang mudah diingat.', description: 'Nama koleksi membantu kamu kembali ke hal yang penting.', confirm: 'Simpan nama', name: session.name });
    if (answer) mutate('RENAME_SESSION', { id: session.id, name: answer.name || session.name }, () => showToast('Nama koleksi diperbarui.'));
  });
  const remove = iconButton('trash', `Hapus koleksi ${session.name}`, async () => {
    const answer = await dialog({ title: 'Hapus koleksi ini?', description: `Koleksi “${session.name}” akan dihapus dari daftar. Tab yang sedang terbuka tidak terpengaruh.`, confirm: 'Hapus koleksi', danger: true });
    if (answer) mutate('DELETE_SESSION', { id: session.id }, () => showToast('Koleksi dihapus.', () => mutate('UNDO_DELETE', { id: session.id }, () => showToast('Koleksi dikembalikan.'))));
  });
  actions.append(restore, rename, remove);
  heading.append(actions);
  card.append(heading);
  if (expanded) {
    const rows = element('div', 'saved-tab-list');
    session.tabs.filter((tab) => !state.search || matches(tab) || session.name.toLocaleLowerCase('id').includes(state.search.toLocaleLowerCase('id'))).forEach((tab) => rows.append(tabRow(tab, session)));
    card.append(rows);
  }
  return card;
}

function renderSaved() {
  const list = $('#list');
  list.replaceChildren();
  const query = state.search.toLocaleLowerCase('id');
  const sessions = state.sessions.filter((session) => session.name.toLocaleLowerCase('id').includes(query) || session.tabs.some(matches));
  if (!sessions.length) {
    list.append(state.search
      ? emptyState('search', 'Koleksi belum ditemukan.', 'Coba cari nama koleksi, judul halaman, atau nama situs.')
      : emptyState('folder', 'Hal penting punya tempatnya.', 'Simpan tab dari halaman Tab terbuka. Koleksimu akan menunggu di sini, siap dilanjutkan.'));
  } else sessions.forEach((session) => list.append(sessionCard(session)));
  $('#results-count').textContent = `${sessions.length} koleksi`;
}

function renderSelection() {
  const tabs = visibleTabs().filter((tab) => !isProtected(tab));
  const selectedVisible = tabs.filter((tab) => state.selected.has(tab.id)).length;
  $('#select-all').checked = tabs.length > 0 && selectedVisible === tabs.length;
  $('#select-all').indeterminate = selectedVisible > 0 && selectedVisible < tabs.length;
  $('#select-all').disabled = !tabs.length;
  $('#selection-label').textContent = state.selected.size ? `${state.selected.size} tab dipilih` : 'Pilih semua';
  $('#archive-button').disabled = state.busy || state.selected.size === 0;
  $('#archive-button span').textContent = state.selected.size ? `Simpan & tutup (${state.selected.size})` : 'Simpan & tutup';
}

function render() {
  const duplicateCount = duplicates().length;
  const staleCount = stale().length;
  $('#stat-live').textContent = state.tabs.length;
  $('#stat-duplicates').textContent = duplicateCount;
  $('#stat-stale').textContent = staleCount;
  $('#stat-stale-description').textContent = `tidak dipakai ${state.settings.staleDays} hari`;
  $('#filter-duplicates-count').textContent = duplicateCount;
  $('#filter-stale-count').textContent = staleCount;
  $('#nav-live-count').textContent = state.tabs.length;
  $('#nav-saved-count').textContent = state.sessions.length;
  $('#breadcrumb-view').textContent = state.view === 'live' ? 'Tab terbuka' : 'Koleksi tersimpan';
  $$('.nav-item').forEach((button) => { button.classList.toggle('active', button.dataset.view === state.view); if (button.dataset.view === state.view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $$('.filter-tab').forEach((button) => { button.classList.toggle('active', button.dataset.filter === state.filter); button.setAttribute('aria-selected', String(button.dataset.filter === state.filter)); button.tabIndex = button.dataset.filter === state.filter ? 0 : -1; });
  const saved = state.view === 'saved';
  $('.filter-tabs').hidden = saved;
  $('#select-all').parentElement.hidden = saved;
  $('#list-footer').hidden = saved;
  $('#stale-setting').hidden = saved || state.filter !== 'stale';
  $('#stale-days').value = String(state.settings.staleDays);
  $('#section-title').textContent = saved ? 'Yang penting, tetap tersimpan.' : 'Saatnya memberi ruang';
  $('#section-subtitle').textContent = saved ? 'Kembali ke koleksimu kapan pun kamu siap.' : state.filter === 'duplicates' ? 'Mulai dari tab yang tidak perlu terbuka dua kali.' : state.filter === 'stale' ? 'Tautan lama bisa disimpan tanpa terus memenuhi browser.' : 'Semua tab web, dari seluruh jendela browsermu.';
  $('#search').placeholder = saved ? 'Cari koleksi atau tautan…' : 'Cari judul atau situs…';
  $('#search').setAttribute('aria-label', saved ? 'Cari koleksi atau tautan' : 'Cari judul atau situs');
  $('#footer-note').textContent = state.filter === 'duplicates' ? 'Satu salinan tetap terbuka. Tab aktif, dipin, dan bersuara dilewati.' : 'Tab aktif, dipin, dan bersuara dilewati. Tautan disimpan sebelum ditutup.';
  $('#results-count').textContent = `${visibleTabs().length} tab`;
  if (saved) renderSaved(); else renderLive();
  renderSelection();
}

function changeView(view) {
  state.view = view;
  state.search = '';
  $('#search').value = '';
  state.selected.clear();
  render();
}

function changeFilter(filter) {
  state.view = 'live';
  state.filter = filter;
  state.selected.clear();
  render();
}

$$('#dialog-form [value="cancel"]').forEach((button) => { button.formNoValidate = true; });
$$('[data-view]').forEach((button) => button.addEventListener('click', () => changeView(button.dataset.view)));
$$('[data-filter]').forEach((button) => button.addEventListener('click', () => changeFilter(button.dataset.filter)));
$('.filter-tabs').addEventListener('keydown', (event) => {
  const tabs = $$('.filter-tab');
  const current = tabs.indexOf(document.activeElement);
  if (current < 0) return;
  let next;
  if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') next = (current + tabs.length - 1) % tabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else return;
  event.preventDefault();
  tabs[next].focus();
  changeFilter(tabs[next].dataset.filter);
});
$('#search').addEventListener('input', (event) => { state.search = event.target.value.trim(); render(); });
$('#select-all').addEventListener('change', (event) => {
  visibleTabs().filter((tab) => !isProtected(tab)).forEach((tab) => { if (event.target.checked) state.selected.add(tab.id); else state.selected.delete(tab.id); });
  render();
});
$('#stale-days').addEventListener('change', (event) => mutate('SET_SETTINGS', { staleDays: Number(event.target.value) }));
$('#archive-button').addEventListener('click', archiveSelected);
$('#refresh-button').addEventListener('click', refresh);
$('#toast-close').addEventListener('click', () => { $('#toast').hidden = true; clearTimeout(toastTimer); });
$('#toast-action').addEventListener('click', () => { const action = undoAction; $('#toast').hidden = true; undoAction = undefined; clearTimeout(toastTimer); if (action) action(); });
$('#export-button').addEventListener('click', async () => {
  try {
    const backup = await send('EXPORT_DATA');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = element('a');
    link.href = url;
    link.download = `tabless-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Cadangan koleksi berhasil diekspor. Simpan file di tempat aman.');
  } catch (error) { showError(error); }
});
$('#import-button').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 8_000_000) { showToast('File terlalu besar. Ukuran maksimal 8 MB.'); return; }
  try {
    const backup = JSON.parse(await file.text());
    await mutate('IMPORT_DATA', { backup }, (data) => { changeView('saved'); showToast(`${data.importedCount} koleksi berhasil diimpor.`); });
  } catch { showToast('File belum bisa dibaca. Gunakan file JSON cadangan Tabless.'); }
});
document.addEventListener('keydown', (event) => {
  if ($('#action-dialog').open || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { event.preventDefault(); $('#search').focus(); }
  if (event.key === 'Escape' && document.activeElement === $('#search')) { $('#search').value = ''; state.search = ''; $('#search').blur(); render(); }
});
window.addEventListener('focus', scheduleRefresh);
if (!previewMode) {
  chrome.tabs.onCreated.addListener(scheduleRefresh);
  chrome.tabs.onRemoved.addListener(scheduleRefresh);
  chrome.tabs.onUpdated.addListener(scheduleRefresh);
  chrome.tabs.onActivated.addListener(scheduleRefresh);
  chrome.tabs.onMoved.addListener(scheduleRefresh);
  chrome.tabs.onAttached.addListener(scheduleRefresh);
  chrome.storage.onChanged.addListener(scheduleRefresh);
} else $('#preview-banner').hidden = false;

refresh();
