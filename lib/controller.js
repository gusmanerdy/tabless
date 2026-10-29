import { DEFAULT_SETTINGS, STALE_DAYS, cleanName, findStaleTabs, getDuplicateCandidates, isProtected, isSafeUrl, validateBackup } from './model.js';

const PREFIX = 'tabless.session.';
const SETTINGS_KEY = 'tabless.settings';
const UNDO_RETENTION = 60_000;

// Chrome storage may reorder dictionary keys; array order still matters.
function stableJSON(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

export function createController(api, { now = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
  let queue = Promise.resolve();
  const key = id => PREFIX + id;
  const liveTabs = async () => (await api.tabs.query({ windowType: 'normal' }))
    .filter(tab => !tab.incognito && isSafeUrl(tab.url));
  const settings = async () => {
    const value = (await api.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    return STALE_DAYS.includes(value?.staleDays) ? { staleDays: value.staleDays } : { ...DEFAULT_SETTINGS };
  };
  const sessions = async () => Object.entries(await api.storage.local.get(null))
    .filter(([k, s]) => k.startsWith(PREFIX) && s && Array.isArray(s.tabs) && !s.deletedAt)
    .map(([, s]) => s).sort((a, b) => b.createdAt - a.createdAt);
  async function getSession(id, includeDeleted = false) {
    if (typeof id !== 'string' || !id || id.length > 100) throw new Error('Koleksi tidak valid.');
    const session = (await api.storage.local.get(key(id)))[key(id)];
    if (!session || (!includeDeleted && session.deletedAt)) throw new Error('Koleksi sudah tidak tersedia.');
    return session;
  }
  // Read-after-write ensures storage failure or truncation cannot lead to closure.
  async function persistVerified(session) {
    await api.storage.local.set({ [key(session.id)]: session });
    const stored = (await api.storage.local.get(key(session.id)))[key(session.id)];
    if (stableJSON(stored) !== stableJSON(session)) {
      throw new Error('Penyimpanan belum terverifikasi. Tab tetap terbuka; coba lagi.');
    }
  }
  async function purgeExpiredTrash() {
    const all = await api.storage.local.get(null);
    const expired = Object.entries(all).filter(([k, session]) => k.startsWith(PREFIX) &&
      Number.isFinite(session?.deletedAt) && session.deletedAt <= now() - UNDO_RETENTION).map(([k]) => k);
    if (expired.length) await api.storage.local.remove(expired);
  }
  function allowedIds(source, tabs, prefs) {
    if (source === 'duplicates') return new Set(getDuplicateCandidates(tabs).map(t => t.id));
    if (source === 'stale') return new Set(findStaleTabs(tabs, prefs.staleDays, now()).map(t => t.id));
    return new Set(tabs.filter(t => !isProtected(t)).map(t => t.id));
  }
  function matchesSnapshot(tab, expected) {
    return tab && tab.url === expected.url && !isProtected(tab) &&
      !(Number.isFinite(expected.lastAccessed) && tab.lastAccessed > expected.lastAccessed);
  }

  async function dispatch(message) {
    await purgeExpiredTrash();
    switch (message.type) {
      case 'GET_STATE': {
        const [tabs, collections, prefs] = await Promise.all([liveTabs(), sessions(), settings()]);
        return { tabs, sessions: collections, settings: prefs };
      }
      case 'SET_SETTINGS': {
        if (!STALE_DAYS.includes(message.staleDays)) throw new Error('Batas usia tab tidak valid.');
        await api.storage.local.set({ [SETTINGS_KEY]: { staleDays: message.staleDays } });
        return { staleDays: message.staleDays };
      }
      case 'ARCHIVE_TABS': {
        if (!['duplicates', 'stale', 'manual'].includes(message.source) || !Array.isArray(message.tabs) ||
            !message.tabs.length || message.tabs.length > 5000) throw new Error('Pilih tab yang ingin disimpan.');
        const requested = new Map();
        for (const tab of message.tabs) {
          if (!Number.isInteger(tab?.id) || !isSafeUrl(tab.url)) throw new Error('Pilihan tab tidak valid.');
          requested.set(tab.id, tab);
        }
        const [tabs, prefs] = await Promise.all([liveTabs(), settings()]);
        const allowed = allowedIds(message.source, tabs, prefs);
        const chosen = tabs.filter(tab => requested.has(tab.id) && allowed.has(tab.id) && matchesSnapshot(tab, requested.get(tab.id)));
        if (!chosen.length) throw new Error('Pilihan tab sudah berubah atau sedang dilindungi. Muat ulang daftar dan pilih lagi.');
        const session = {
          id: uuid(), name: cleanName(message.name, `Rapikan · ${new Date(now()).toLocaleDateString('id-ID')}`),
          createdAt: now(), source: message.source, closedCount: 0,
          tabs: chosen.map(tab => ({ id: uuid(), title: (tab.title || tab.url).slice(0, 1000), url: tab.url })),
        };
        await persistVerified(session);
        let closedCount = 0;
        for (const snapshot of chosen) {
          // Recheck immediately before every close: browsing can continue during a save.
          let currentTabs;
          try { currentTabs = await liveTabs(); }
          catch { break; /* Return partial progress; the verified collection is intact. */ }
          const current = currentTabs.find(tab => tab.id === snapshot.id);
          if (!matchesSnapshot(current, snapshot) || !allowedIds(message.source, currentTabs, prefs).has(snapshot.id)) continue;
          try { await api.tabs.remove(snapshot.id); closedCount++; }
          catch { /* Saved copy remains available even when Chrome declines to close. */ }
        }
        session.closedCount = closedCount;
        // The verified initial copy remains usable if this metadata update fails.
        try { await api.storage.local.set({ [key(session.id)]: session }); } catch { /* durable copy already exists */ }
        return { sessionId: session.id, savedCount: chosen.length, closedCount, skippedCount: requested.size - closedCount };
      }
      case 'RESTORE_SESSION': {
        const session = await getSession(message.id);
        let openedCount = 0;
        let failedCount = 0;
        let windowId;
        for (const tab of session.tabs) {
          if (!isSafeUrl(tab.url)) { failedCount++; continue; }
          try {
            if (windowId === undefined) {
              const window = await api.windows.create({ url: tab.url, focused: true, type: 'normal' });
              windowId = window.id;
            } else {
              await api.tabs.create({ url: tab.url, windowId, active: false });
            }
            openedCount++;
          } catch { failedCount++; }
        }
        return { openedCount, failedCount };
      }
      case 'OPEN_SAVED_TAB': {
        const session = await getSession(message.sessionId);
        const tab = session.tabs.find(t => t.id === message.tabId);
        if (!tab || !isSafeUrl(tab.url)) throw new Error('Tautan tidak tersedia.');
        await api.tabs.create({ url: tab.url, active: true });
        return { openedCount: 1 };
      }
      case 'RENAME_SESSION': {
        const session = await getSession(message.id);
        session.name = cleanName(message.name, session.name);
        await persistVerified(session);
        return { id: session.id };
      }
      case 'DELETE_SESSION': {
        const session = await getSession(message.id);
        session.deletedAt = now();
        await persistVerified(session);
        return { id: session.id };
      }
      case 'UNDO_DELETE': {
        const session = await getSession(message.id, true);
        delete session.deletedAt;
        await persistVerified(session);
        return { id: session.id };
      }
      case 'EXPORT_DATA':
        return { format: 'tabless', version: 1, exportedAt: now(), sessions: await sessions() };
      case 'IMPORT_DATA': {
        const imported = validateBackup(message.backup);
        const additions = {};
        for (const session of imported) {
          session.id = uuid();
          session.closedCount = 0;
          session.tabs = session.tabs.map(t => ({ ...t, id: uuid() }));
          additions[key(session.id)] = session;
        }
        // One batched write; existing collection keys are never overwritten.
        if (imported.length) await api.storage.local.set(additions);
        return { importedCount: imported.length };
      }
      default: throw new Error('Perintah tidak dikenal.');
    }
  }
  return {
    handle(message) {
      // Serialize all requests so simultaneous dashboards cannot overwrite changes.
      const result = queue.then(() => dispatch(message));
      queue = result.catch(() => {});
      return result;
    },
  };
}
