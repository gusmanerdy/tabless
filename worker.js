import { createController } from './lib/controller.js';

const controller = createController(chrome);

async function openDashboard() {
  const url = chrome.runtime.getURL('index.html');
  const existing = (await chrome.tabs.query({})).find(tab => tab.url === url && !tab.incognito);
  if (existing) {
    await chrome.windows.update(existing.windowId, { focused: true });
    await chrome.tabs.update(existing.id, { active: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

chrome.action.onClicked.addListener(() => { openDashboard().catch(console.error); });
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') openDashboard().catch(console.error);
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url?.split('?')[0] !== chrome.runtime.getURL('index.html')) return false;
  controller.handle(message).then(
    data => sendResponse({ ok: true, data }),
    error => sendResponse({ ok: false, error: error.message || 'Operasi gagal. Coba lagi.' }),
  );
  return true;
});
