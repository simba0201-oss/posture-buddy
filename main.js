// Posture Buddy - 완성본: 트레이 + 타이머 + 알림 + 체조 캐릭터 + 설정 저장
const { app, Tray, Menu, nativeImage, BrowserWindow, Notification, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;
let settingsWin = null;
let exerciseWin = null;

// ── 설정 저장/불러오기 (앱 전용 폴더에 settings.json으로 기억) ──
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
let settings = { intervalMinutes: 30, running: false, autoLaunch: false, panelOpacity: 85 };

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) };
  } catch (e) { /* 첫 실행이면 파일 없음 → 기본값 사용 */ }
}
function saveSettings() {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings));
}

// ── 타이머 ──
let targetTime = null;
let ticker = null;

function startTimer(minutes) {
  settings.intervalMinutes = minutes;
  settings.running = true;
  saveSettings();
  targetTime = Date.now() + minutes * 60 * 1000; // 시계 기준 → 잠자기 후에도 정확
  if (!ticker) ticker = setInterval(check, 1000);
}

function stopTimer() {
  settings.running = false;
  saveSettings();
  targetTime = null;
  clearInterval(ticker);
  ticker = null;
  if (process.platform === 'darwin') tray.setTitle('');
  sendTick();
}

function check() {
  const remain = targetTime - Date.now();
  sendTick();
  if (process.platform === 'darwin') {
    const m = Math.floor(remain / 60000);
    const s = Math.floor((remain % 60000) / 1000);
    tray.setTitle(` ${m}:${String(s).padStart(2, '0')}`);
  }
  if (remain <= 0) {
    fireAlert();
    targetTime = Date.now() + settings.intervalMinutes * 60 * 1000; // 자동 재시작
  }
}

function sendTick() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('tick', targetTime ? Math.max(0, targetTime - Date.now()) : null);
  }
}

function fireAlert() {
  shell.beep();
  new Notification({
    title: '허리를 펴세요! 🧘',
    body: '고개를 똑바로 하고 어깨를 뒤로. 체조 친구가 등장합니다!'
  }).show();
  openExercise();
}

// ── 체조 창 (투명, 항상 위) ──
function openExercise() {
  if (exerciseWin && !exerciseWin.isDestroyed()) return;
  exerciseWin = new BrowserWindow({
    width: 380,
    height: 520,
    transparent: true,
    backgroundColor: '#00000000', // 완전 투명 (앞 00 = 불투명도 0)
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  exerciseWin.center();
  exerciseWin.loadFile('exercise.html');
}

// ── 설정 창 ──
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 320,
    height: 500,
    resizable: false,
    transparent: true,            // 배경화면이 비치는 완전 투명
    frame: false,                 // 제목 표시줄 제거 (닫기 버튼은 직접 제공)
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  settingsWin.loadFile('settings.html');
}

// ── 창 ↔ 두뇌 연결 ──
ipcMain.handle('start-timer', (e, minutes) => {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m < 1 || m > 180) return { ok: false }; // 입력 검증
  startTimer(m);
  return { ok: true };
});
ipcMain.handle('stop-timer', () => { stopTimer(); return { ok: true }; });
ipcMain.handle('close-exercise', () => {
  if (exerciseWin && !exerciseWin.isDestroyed()) exerciseWin.close();
  return { ok: true };
});
ipcMain.handle('set-opacity', (e, v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 20 || n > 100) return { ok: false }; // 입력 검증
  settings.panelOpacity = n;
  saveSettings();
  return { ok: true };
});
ipcMain.handle('get-state', () => ({
  running: targetTime !== null,
  intervalMinutes: settings.intervalMinutes,
  autoLaunch: settings.autoLaunch,
  panelOpacity: settings.panelOpacity,
  remainMs: targetTime ? Math.max(0, targetTime - Date.now()) : null
}));
ipcMain.handle('set-autolaunch', (e, on) => {
  settings.autoLaunch = !!on;
  saveSettings();
  app.setLoginItemSettings({ openAtLogin: settings.autoLaunch });
  return { ok: true };
});

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.hide();

  loadSettings();

  let icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  icon = icon.resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('Posture Buddy - 허리 펴기 알리미');

  const menu = Menu.buildFromTemplate([
    { label: '설정 열기', click: openSettings },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => tray.popUpContextMenu());

  // 지난번에 실행 중이었다면 타이머 자동 시작
  if (settings.running) {
    startTimer(settings.intervalMinutes);
  } else {
    openSettings();
  }
});

app.on('window-all-closed', () => {
  // 창을 닫아도 트레이에 계속 상주
});
