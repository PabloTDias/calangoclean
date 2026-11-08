const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('photos', {
  init: (mode) => ipcRenderer.invoke('photos:init', mode),
  taskComplete: () => ipcRenderer.invoke('photos:task-complete'),
  addFolder: (mode) => ipcRenderer.invoke('photos:add-folder', mode),
  scan: (rootIds, mode) => ipcRenderer.invoke('photos:scan', rootIds, mode),
  cancel: (mode) => ipcRenderer.invoke('photos:cancel', mode),
  thumbnail: (id, mode) => ipcRenderer.invoke('photos:thumbnail', id, mode),
  reveal: (id, mode) => ipcRenderer.invoke('photos:reveal', id, mode),
  trash: (confirmation) => ipcRenderer.invoke('photos:trash', confirmation),
  openPhotos: () => ipcRenderer.invoke('photos:open-photos'),
  onAppearance: (callback) => {
    const listener = (_event, appearance) => callback(appearance);
    ipcRenderer.on('appearance:changed', listener);
    return () => ipcRenderer.removeListener('appearance:changed', listener);
  },
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('photos:progress', listener);
    return () => ipcRenderer.removeListener('photos:progress', listener);
  },
});
