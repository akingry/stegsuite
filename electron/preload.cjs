const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('stegsuiteDesktop', {
  saveHelperUrl: `http://127.0.0.1:${process.env.STEGSUITE_SAVE_PORT || 43123}`,
});
