export const DAY = 86_400_000;
export const DEFAULT_SETTINGS = Object.freeze({ staleDays: 7 });
export const STALE_DAYS = [1, 3, 7, 14, 30];

export function isSafeUrl(url) {
  if (typeof url !== 'string' || url.length > 32768) return false;
  try { return ['http:', 'https:'].includes(new URL(url).protocol); }
  catch { return false; }
}

export function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'Tautan'; }
}

export function canonicalUrl(url) {
  return isSafeUrl(url) ? new URL(url).href : null;
}

export function isProtected(tab) {
  return Boolean(tab.active || tab.pinned || tab.audible || tab.incognito ||
    tab.pendingUrl || tab.status === 'loading' || !isSafeUrl(tab.url));
}

// Keep protected copies, otherwise keep the most recently accessed copy.
// Query strings and fragments are significant and are never removed.
export function getDuplicateCandidates(tabs) {
  const groups = new Map();
  for (const tab of tabs) {
    if (tab.incognito) continue;
    const key = canonicalUrl(tab.url);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tab);
  }
  const candidates = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) =>
      Number(isProtected(b)) - Number(isProtected(a)) ||
      (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.id - b.id);
    candidates.push(...sorted.slice(1).filter(tab => !isProtected(tab)));
  }
  return candidates;
}

export function findStaleTabs(tabs, days, now = Date.now()) {
  return tabs.filter(tab => !isProtected(tab) && Number.isFinite(tab.lastAccessed) &&
    tab.lastAccessed > 0 && tab.lastAccessed <= now - days * DAY);
}

export function cleanName(name, fallback = 'Koleksi tab') {
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : fallback;
}

export function validateBackup(backup) {
  if (!backup || backup.format !== 'tabless' || backup.version !== 1 ||
      !Array.isArray(backup.sessions) || backup.sessions.length > 1000 ||
      JSON.stringify(backup).length > 8_000_000) {
    throw new Error('Format cadangan tidak valid. Pilih berkas JSON ekspor Tabless (versi 1, maksimal 8 MB).');
  }
  let total = 0;
  return backup.sessions.map(session => {
    if (!session || !Array.isArray(session.tabs) || !session.tabs.length || (total += session.tabs.length) > 50000) {
      throw new Error('Koleksi cadangan kosong atau terlalu besar. Tidak ada data yang diimpor.');
    }
    const tabs = session.tabs.map(tab => {
      if (!tab || !isSafeUrl(tab.url)) throw new Error('Cadangan mengandung tautan yang tidak didukung. Tidak ada data yang diimpor.');
      return { title: typeof tab.title === 'string' ? tab.title.slice(0, 1000) : hostname(tab.url), url: tab.url };
    });
    return {
      name: cleanName(session.name),
      createdAt: Number.isFinite(session.createdAt) && session.createdAt > 0 ? session.createdAt : Date.now(),
      source: 'import',
      tabs,
    };
  });
}
