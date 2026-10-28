const { contextBridge, ipcRenderer } = require('electron');
async function call(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
contextBridge.exposeInMainWorld('bubble', {
  expand: () => call('bubble:expand'),
  bounds: () => call('bubble:bounds'),
  move: position => call('bubble:move', position),
  menu: () => call('bubble:menu')
});
