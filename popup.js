const KEY = 'fmQrKeep';
const $ = (id) => document.getElementById(id);

let settings = { enabled: true, forceShow: true, float: true, autoOpen: true };

const syncUI = () => {
  $('enabled').checked = !!settings.enabled;
  $('forceShow').checked = !!settings.forceShow;
  $('float').checked = !!settings.float;
  $('autoOpen').checked = !!settings.autoOpen;
};

['enabled', 'forceShow', 'float', 'autoOpen'].forEach((id) => {
  $(id).addEventListener('change', (e) => {
    settings[id] = e.target.checked;
    chrome.storage.local.set({ [KEY]: settings });
  });
});

chrome.storage.local.get(KEY, (res) => {
  if (res && res[KEY]) settings = Object.assign({}, settings, res[KEY]);
  syncUI();
});
