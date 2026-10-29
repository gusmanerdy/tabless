// Browser-only sandbox. These are sample tabs, never the user's browser tabs.
import { createController } from './lib/controller.js';
import { DAY } from './lib/model.js';

const STORE = 'tabless.preview.v1';
const clock = Date.now();
const examples = [
  ['Linear — Product roadmap', 'https://linear.app/', 0.1, { active: true }],
  ['Linear — Product roadmap', 'https://linear.app/', 2],
  ['Figma: Tabless exploration', 'https://www.figma.com/design/tabless', 0.2],
  ['Figma: Tabless exploration', 'https://www.figma.com/design/tabless', 1],
  ['GitHub — ProjectTabless', 'https://github.com/', 0.3],
  ['GitHub — ProjectTabless', 'https://github.com/', 3],
  ['A calmer space to work — Notion', 'https://www.notion.so/', 0.4],
  ['A calmer space to work — Notion', 'https://www.notion.so/', 4],
  ['Designing for focus — A List Apart', 'https://alistapart.com/', 12],
  ['MDN — JavaScript guide', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide', 9],
  ['Chrome Extensions documentation', 'https://developer.chrome.com/docs/extensions', 8],
  ['Inbox — Gmail', 'https://mail.google.com/', 11, { pinned: true }],
  ['Focus playlist — Spotify', 'https://open.spotify.com/', 1, { audible: true }],
  ['Read later — Smashing Magazine', 'https://www.smashingmagazine.com/', 16],
];
const fresh = () => ({
  tabs: examples.map(([title, url, age, flags], index) => ({
    id: index + 1, title, url, index, windowId: 1, status: 'complete',
    lastAccessed: clock - age * DAY, ...flags,
  })),
  storage: {
    'tabless.session.sample': {
      id: 'sample', name: 'Inspirasi untuk nanti', source: 'manual', createdAt: clock - DAY,
      closedCount: 3,
      tabs: [
        { id: 'saved-1', title: 'The creative independent', url: 'https://thecreativeindependent.com/' },
        { id: 'saved-2', title: 'Are.na — Connecting ideas', url: 'https://www.are.na/' },
        { id: 'saved-3', title: 'Read.cv', url: 'https://read.cv/' },
      ],
    },
  },
});
let state;
try { state = JSON.parse(localStorage.getItem(STORE)) || fresh(); } catch { state = fresh(); }
if (!Array.isArray(state.tabs) || !state.storage) state = fresh();
function persist() { localStorage.setItem(STORE, JSON.stringify(state)); }
function addTab(details) {
  const tab = { ...details, id: Math.max(0, ...state.tabs.map(t => t.id)) + 1,
    windowId: details.windowId || 1, lastAccessed: Date.now(), index: state.tabs.length, status: 'complete' };
  state.tabs.push(tab);
  persist();
  return structuredClone(tab);
}
const api = {
  storage: { local: {
    async get(keys) {
      if (keys === null) return structuredClone(state.storage);
      const names = Array.isArray(keys) ? keys : [keys];
      return structuredClone(Object.fromEntries(names.filter(k => k in state.storage).map(k => [k, state.storage[k]])));
    },
    async set(values) { Object.assign(state.storage, structuredClone(values)); persist(); },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete state.storage[key];
      persist();
    },
  } },
  tabs: {
    async query() { return structuredClone(state.tabs); },
    async remove(id) { state.tabs = state.tabs.filter(t => t.id !== id); persist(); },
    async create(details) { return addTab(details); },
  },
  windows: {
    async create(details) {
      const id = Math.max(0, ...state.tabs.map(t => t.windowId)) + 1;
      addTab({ url: details.url, title: new URL(details.url).hostname, windowId: id, active: true });
      return { id };
    },
  },
};
const controller = createController(api);
export async function sendMessage(message) {
  try { return { ok: true, data: await controller.handle(message) }; }
  catch (error) { return { ok: false, error: error.message }; }
}
