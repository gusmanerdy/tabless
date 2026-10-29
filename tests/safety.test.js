import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../lib/controller.js';
import { DAY, findStaleTabs, getDuplicateCandidates, isSafeUrl } from '../lib/model.js';

const NOW = 1_800_000_000_000;
const copy = value => structuredClone(value);
const tab = (id, changes = {}) => ({
  id, windowId: 1, index: id - 1, title: `Tab ${id}`, url: `https://example.com/${id}`,
  active: false, pinned: false, audible: false, incognito: false,
  status: 'complete', lastAccessed: NOW - 10 * DAY, ...changes,
});
const snapshot = tabs => tabs.map(({ id, url, lastAccessed }) => ({ id, url, lastAccessed }));
const archive = (tabs, source = 'manual') => ({ type: 'ARCHIVE_TABS', tabs: snapshot(tabs), source, name: 'Tes rapikan' });
const saved = (id = 'existing') => ({
  id, name: 'Koleksi lama', createdAt: NOW - DAY, source: 'manual', closedCount: 2,
  tabs: [
    { id: 'link-a', title: 'A', url: 'https://example.com/a' },
    { id: 'link-b', title: 'B', url: 'https://example.com/b' },
  ],
});

// This fake copies values at Chrome boundaries, so tests cannot accidentally pass
// because controller memory and durable storage reference the same object.
function fixture({ tabs = [], storage = {}, query, set, get, remove, createTab, createWindow, now = () => NOW } = {}) {
  const state = {
    tabs: copy(tabs), storage: copy(storage), queryCount: 0, getCount: 0,
    writes: [], storageRemovals: [], removeAttempts: [], removed: [], openedTabs: [], openedWindows: [],
  };
  const api = {
    tabs: {
      async query(options) {
        state.queryCount++;
        if (query) await query(state, state.queryCount, options);
        return copy(state.tabs);
      },
      async remove(id) {
        state.removeAttempts.push(id);
        if (remove) await remove(id, state);
        state.tabs = state.tabs.filter(t => t.id !== id);
        state.removed.push(id);
      },
      async create(options) {
        if (createTab) await createTab(options, state);
        state.openedTabs.push(copy(options));
        return { id: 100 + state.openedTabs.length, ...options };
      },
    },
    windows: {
      async create(options) {
        if (createWindow) await createWindow(options, state);
        state.openedWindows.push(copy(options));
        return { id: 1000 + state.openedWindows.length };
      },
    },
    storage: {
      local: {
        async get(keys) {
          state.getCount++;
          const result = keys === null ? copy(state.storage) :
            Object.fromEntries((Array.isArray(keys) ? keys : [keys])
              .filter(k => Object.hasOwn(state.storage, k)).map(k => [k, copy(state.storage[k])]));
          return get ? await get(keys, result, state) : result;
        },
        async set(values) {
          if (set) await set(values, state);
          state.writes.push(copy(values));
          Object.assign(state.storage, copy(values));
        },
        async remove(keys) {
          const removedKeys = Array.isArray(keys) ? keys : [keys];
          state.storageRemovals.push(copy(removedKeys));
          for (const key of removedKeys) delete state.storage[key];
        },
      },
    },
  };
  let id = 0;
  return { state, controller: createController(api, { now, uuid: () => `generated-${++id}` }) };
}

test('storage write failure prevents every tab close', async () => {
  const tabs = [tab(1), tab(2)];
  const { controller, state } = fixture({ tabs, set: () => { throw new Error('Quota exceeded'); } });
  await assert.rejects(controller.handle(archive(tabs)), /Quota exceeded/);
  assert.deepEqual(state.removeAttempts, []);
  assert.equal(state.tabs.length, 2);
});

test('read-back mismatch prevents every tab close', async () => {
  const tabs = [tab(1)];
  const { controller, state } = fixture({
    tabs,
    get: (keys, result) => typeof keys === 'string' && keys.startsWith('tabless.session.') ? {} : result,
  });
  await assert.rejects(controller.handle(archive(tabs)), /terverifikasi/);
  assert.deepEqual(state.removeAttempts, []);
});

test('verified storage tolerates reordered dictionary keys, including nested link objects', async () => {
  const reorderKeys = value => {
    if (Array.isArray(value)) return value.map(reorderKeys);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorderKeys(item)]));
    }
    return value;
  };
  const tabs = [tab(1), tab(2)];
  const { controller, state } = fixture({ tabs, get: (_keys, result) => reorderKeys(result) });
  const result = await controller.handle(archive(tabs));
  assert.equal(result.savedCount, 2);
  assert.equal(result.closedCount, 2);
  assert.equal(state.storage[`tabless.session.${result.sessionId}`].tabs.length, 2);
});

test('verified storage still rejects reordered links because array order is significant', async () => {
  const tabs = [tab(1), tab(2)];
  const { controller, state } = fixture({
    tabs, get: (keys, result) => {
      if (typeof keys === 'string' && keys.startsWith('tabless.session.') && result[keys]) {
        result[keys].tabs.reverse();
      }
      return result;
    },
  });
  await assert.rejects(controller.handle(archive(tabs)), /terverifikasi/);
  assert.deepEqual(state.removeAttempts, []);
});

for (const [label, change] of [
  ['URL changed', { url: 'https://example.com/a-different-page' }],
  ['newly active', { active: true }],
  ['newly pinned', { pinned: true }],
  ['newly audible', { audible: true }],
  ['navigation pending', { pendingUrl: 'https://example.com/next' }],
  ['page loading', { status: 'loading' }],
  ['recently visited', { lastAccessed: NOW }],
]) {
  test(`rechecking immediately before closure protects a tab when ${label}`, async () => {
    const tabs = [tab(1)];
    const { controller, state } = fixture({
      tabs, query: (state, count) => { if (count === 2) Object.assign(state.tabs[0], change); },
    });
    const result = await controller.handle(archive(tabs));
    assert.equal(result.savedCount, 1);
    assert.equal(result.closedCount, 0);
    assert.equal(result.skippedCount, 1);
    assert.deepEqual(state.removeAttempts, []);
    assert.equal(state.storage[`tabless.session.${result.sessionId}`].tabs[0].url, tabs[0].url);
  });
}

test('initially protected tabs cannot be closed even when explicitly requested', async () => {
  const tabs = [
    tab(1, { active: true }), tab(2, { pinned: true }), tab(3, { audible: true }),
    tab(4, { incognito: true }), tab(5, { pendingUrl: 'https://example.com/next' }),
  ];
  const { controller, state } = fixture({ tabs });
  await assert.rejects(controller.handle(archive(tabs)), /dilindungi/);
  assert.deepEqual(state.removeAttempts, []);
  assert.deepEqual(state.writes, []);
});

test('duplicate cleanup preserves at least one open copy and every saved link', async () => {
  const tabs = [tab(1, { url: 'https://example.com/shared', lastAccessed: NOW - DAY }),
    tab(2, { url: 'https://example.com/shared' }), tab(3, { url: 'https://example.com/shared' })];
  const { controller, state } = fixture({ tabs });
  const result = await controller.handle(archive(tabs, 'duplicates'));
  assert.equal(result.savedCount, 2);
  assert.equal(result.closedCount, 2);
  assert.deepEqual(state.tabs.map(t => t.id), [1]);
  assert.equal(state.storage[`tabless.session.${result.sessionId}`].tabs.length, 2);
});

test('duplicate cleanup reevaluates remaining copies before every close', async () => {
  const tabs = [tab(1, { url: 'https://example.com/shared' }),
    tab(2, { url: 'https://example.com/shared', lastAccessed: NOW - DAY })];
  const { controller, state } = fixture({
    tabs, query: (state, count) => { if (count === 2) state.tabs = state.tabs.filter(t => t.id !== 2); },
  });
  const result = await controller.handle(archive(tabs, 'duplicates'));
  assert.equal(result.closedCount, 0);
  assert.deepEqual(state.tabs.map(t => t.id), [1]);
});

test('duplicates preserve distinct query strings and fragments', () => {
  const tabs = [
    tab(1, { url: 'https://example.com/doc?id=1#intro' }),
    tab(2, { url: 'https://example.com/doc?id=2#intro' }),
    tab(3, { url: 'https://example.com/doc?id=1#other' }),
    tab(4, { url: 'https://example.com/doc?id=1#intro', lastAccessed: NOW - DAY }),
  ];
  assert.deepEqual(getDuplicateCandidates(tabs).map(t => t.id), [1]);
});

test('duplicate classification retains protected copies and ignores incognito copies', () => {
  const url = 'https://example.com/shared';
  assert.deepEqual(getDuplicateCandidates([tab(1, { url, pinned: true }), tab(2, { url })]).map(t => t.id), [2]);
  assert.deepEqual(getDuplicateCandidates([tab(1, { url, incognito: true }), tab(2, { url })]), []);
});

test('stale detection requires a known old activation time and respects protection', () => {
  const tabs = [
    tab(1), tab(2, { lastAccessed: undefined }), tab(3, { lastAccessed: 0 }),
    tab(4, { lastAccessed: NOW + DAY }), tab(5, { lastAccessed: NOW - 6 * DAY }),
    tab(6, { pinned: true }), tab(7, { active: true }), tab(8, { audible: true }),
  ];
  assert.deepEqual(findStaleTabs(tabs, 7, NOW).map(t => t.id), [1]);
});

test('stale cleanup uses persisted threshold and cannot close a recent tab', async () => {
  const tabs = [tab(1, { lastAccessed: NOW - 2 * DAY }), tab(2)];
  const { controller, state } = fixture({ tabs, storage: { 'tabless.settings': { staleDays: 7 } } });
  const result = await controller.handle(archive(tabs, 'stale'));
  assert.equal(result.savedCount, 1);
  assert.deepEqual(state.removed, [2]);
  assert.deepEqual(state.tabs.map(t => t.id), [1]);
});

test('a failed close keeps both the saved copy and still-open tab', async () => {
  const tabs = [tab(1), tab(2)];
  const { controller, state } = fixture({ tabs, remove: id => { if (id === 2) throw new Error('Cannot close tab'); } });
  const result = await controller.handle(archive(tabs));
  assert.equal(result.savedCount, 2);
  assert.equal(result.closedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(state.storage[`tabless.session.${result.sessionId}`].tabs.length, 2);
  assert.deepEqual(state.tabs.map(t => t.id), [2]);
});

test('failed close-count metadata update leaves the verified collection intact', async () => {
  const tabs = [tab(1)];
  let attempts = 0;
  const { controller, state } = fixture({ tabs, set: () => { if (++attempts === 2) throw new Error('Storage unavailable'); } });
  const result = await controller.handle(archive(tabs));
  assert.equal(result.closedCount, 1);
  assert.equal(state.storage[`tabless.session.${result.sessionId}`].tabs[0].url, tabs[0].url);
});

test('a tab-query failure mid-cleanup returns partial counts and preserves every saved link', async () => {
  const tabs = [tab(1), tab(2)];
  const { controller, state } = fixture({
    tabs, query: (_state, count) => { if (count === 3) throw new Error('Chrome query unavailable'); },
  });
  const result = await controller.handle(archive(tabs));
  assert.equal(result.savedCount, 2);
  assert.equal(result.closedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(state.removed, [1]);
  assert.deepEqual(state.tabs.map(t => t.id), [2]);
  assert.deepEqual(state.storage[`tabless.session.${result.sessionId}`].tabs.map(t => t.url), tabs.map(t => t.url));
});

test('partial restore reports failures without removing saved tabs', async () => {
  const collection = saved();
  const { controller, state } = fixture({
    storage: { 'tabless.session.existing': collection },
    createTab: () => { throw new Error('Creation failed'); },
  });
  assert.deepEqual(await controller.handle({ type: 'RESTORE_SESSION', id: 'existing' }), { openedCount: 1, failedCount: 1 });
  assert.equal(state.openedWindows[0].url, collection.tabs[0].url);
  assert.deepEqual(state.storage['tabless.session.existing'], collection);
  assert.deepEqual(state.writes, []);
});

test('all failed restores retain the complete collection', async () => {
  const collection = saved();
  const { controller, state } = fixture({
    storage: { 'tabless.session.existing': collection },
    createWindow: () => { throw new Error('No window'); },
  });
  assert.deepEqual(await controller.handle({ type: 'RESTORE_SESSION', id: 'existing' }), { openedCount: 0, failedCount: 2 });
  assert.deepEqual(state.storage['tabless.session.existing'], collection);
});

test('malformed import does not write partially valid preceding collections', async () => {
  const original = saved();
  const backup = { format: 'tabless', version: 1, sessions: [original,
    { name: 'Unsafe', tabs: [{ title: 'Bad', url: 'javascript:alert(1)' }] }] };
  const { controller, state } = fixture({ storage: { 'tabless.session.existing': original } });
  await assert.rejects(controller.handle({ type: 'IMPORT_DATA', backup }), /tidak didukung/i);
  assert.deepEqual(state.storage, { 'tabless.session.existing': original });
  assert.deepEqual(state.writes, []);
});

test('import creates fresh collection and link IDs and preserves existing collections', async () => {
  const original = saved();
  const { controller, state } = fixture({ storage: { 'tabless.session.existing': original } });
  const backup = { format: 'tabless', version: 1, sessions: [original] };
  assert.deepEqual(await controller.handle({ type: 'IMPORT_DATA', backup }), { importedCount: 1 });
  assert.deepEqual(state.storage['tabless.session.existing'], original);
  const imported = Object.values(state.storage).find(s => s.id !== 'existing');
  assert.ok(imported);
  assert.notEqual(imported.tabs[0].id, original.tabs[0].id);
  assert.equal(imported.tabs[0].url, original.tabs[0].url);
  assert.equal(imported.source, 'import');
  assert.equal(state.writes.length, 1);
});

test('deleted collections are recoverable through undo but excluded from export', async () => {
  const original = saved();
  const { controller, state } = fixture({ storage: { 'tabless.session.existing': original } });
  await controller.handle({ type: 'DELETE_SESSION', id: 'existing' });
  assert.equal((await controller.handle({ type: 'EXPORT_DATA' })).sessions.length, 0);
  assert.equal(state.storage['tabless.session.existing'].tabs.length, 2);
  await controller.handle({ type: 'UNDO_DELETE', id: 'existing' });
  assert.deepEqual((await controller.handle({ type: 'EXPORT_DATA' })).sessions, [original]);
});

test('undo remains available throughout the 60-second retention window', async () => {
  const original = saved();
  let clock = NOW;
  const { controller, state } = fixture({
    storage: { 'tabless.session.existing': original }, now: () => clock,
  });
  await controller.handle({ type: 'DELETE_SESSION', id: 'existing' });
  clock += 59_999;
  await controller.handle({ type: 'UNDO_DELETE', id: 'existing' });
  assert.deepEqual(state.storage['tabless.session.existing'], original);
  assert.deepEqual(state.storageRemovals, []);
});

test('expired trash is reclaimed at 60 seconds without deleting active or unrelated storage', async () => {
  const original = saved();
  const expired = { ...saved('expired'), deletedAt: NOW - 60_000 };
  const older = { ...saved('older'), deletedAt: NOW - 60_001 };
  const recent = { ...saved('recent'), deletedAt: NOW - 59_999 };
  const unrelated = { deletedAt: NOW - DAY, keep: true };
  const { controller, state } = fixture({ storage: {
    'tabless.session.existing': original,
    'tabless.session.expired': expired,
    'tabless.session.older': older,
    'tabless.session.recent': recent,
    'other.settings': unrelated,
  } });
  const result = await controller.handle({ type: 'GET_STATE' });
  assert.deepEqual(result.sessions, [original]);
  assert.equal(Object.hasOwn(state.storage, 'tabless.session.expired'), false);
  assert.equal(Object.hasOwn(state.storage, 'tabless.session.older'), false);
  assert.deepEqual(state.storage['tabless.session.recent'], recent);
  assert.deepEqual(state.storage['other.settings'], unrelated);
  assert.deepEqual(state.storageRemovals, [['tabless.session.expired', 'tabless.session.older']]);
});

test('undo after retention expiry cannot resurrect a purged collection', async () => {
  let clock = NOW;
  const { controller, state } = fixture({
    storage: { 'tabless.session.existing': saved() }, now: () => clock,
  });
  await controller.handle({ type: 'DELETE_SESSION', id: 'existing' });
  clock += 60_000;
  await assert.rejects(controller.handle({ type: 'UNDO_DELETE', id: 'existing' }), /tidak tersedia/);
  assert.equal(Object.hasOwn(state.storage, 'tabless.session.existing'), false);
  assert.deepEqual(state.storageRemovals, [['tabless.session.existing']]);
});

test('concurrent dashboard requests serialize mutations and recover after an error', async () => {
  const original = saved();
  const { controller, state } = fixture({ storage: { 'tabless.session.existing': original } });
  const requests = [
    controller.handle({ type: 'RENAME_SESSION', id: 'existing', name: 'Nama baru' }),
    controller.handle({ type: 'DELETE_SESSION', id: 'existing' }),
  ];
  await Promise.all(requests);
  assert.equal(state.storage['tabless.session.existing'].name, 'Nama baru');
  assert.equal(state.storage['tabless.session.existing'].deletedAt, NOW);
  await assert.rejects(controller.handle({ type: 'SET_SETTINGS', staleDays: -1 }));
  await controller.handle({ type: 'UNDO_DELETE', id: 'existing' });
  assert.equal((await controller.handle({ type: 'GET_STATE' })).sessions[0].name, 'Nama baru');
});

test('only HTTP and HTTPS URLs are eligible to save or restore', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///private/test', 'chrome://settings', 'not a URL']) {
    assert.equal(isSafeUrl(url), false, url);
  }
  assert.equal(isSafeUrl('https://example.com/path?q=1#part'), true);
});
