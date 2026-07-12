// 설정 창(화면)과 main.js(두뇌) 사이의 안전한 다리
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  start: (minutes) => ipcRenderer.invoke('start-timer', minutes),
  stop: () => ipcRenderer.invoke('stop-timer'),
  getState: () => ipcRenderer.invoke('get-state'),
  onTick: (callback) => ipcRenderer.on('tick', (e, ms) => callback(ms)),
  closeExercise: () => ipcRenderer.invoke('close-exercise'),
  setAutoLaunch: (on) => ipcRenderer.invoke('set-autolaunch', on),
  setOpacity: (v) => ipcRenderer.invoke('set-opacity', v),
  closePeek: () => ipcRenderer.invoke('close-peek'),
  setPeek: (opt) => ipcRenderer.invoke('set-peek', opt)
});
