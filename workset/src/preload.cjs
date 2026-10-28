const { contextBridge, ipcRenderer, webUtils } = require('electron');
async function call(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
contextBridge.exposeInMainWorld('workset', {
  load: () => call('state:load'), save: state => call('state:save', state),
  open: id => call('item:open', id), openGroup: id => call('group:open', id), reveal: id => call('item:reveal', id),
  chooseFiles: folder => call('files:choose', !!folder), describeFiles: targets => call('files:describe', targets),
  droppedPath: file => webUtils.getPathForFile(file),
  exportData: () => call('state:export'), importData: () => call('state:import'),
  compact: () => call('window:compact'), minimize: () => call('window:minimize'), maximize: () => call('window:maximize'), close: () => call('window:close'),
  onPinError: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('window:pin-error', listener);
    return () => ipcRenderer.removeListener('window:pin-error', listener);
  },
  onViewChanged: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('window:view', listener);
    return () => ipcRenderer.removeListener('window:view', listener);
  }
});
