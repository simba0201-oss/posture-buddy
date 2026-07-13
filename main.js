// Posture Buddy - 완성본: 트레이 + 타이머 + 알림 + 체조 캐릭터 + 설정 저장
const { app, Tray, Menu, nativeImage, BrowserWindow, Notification, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;
let settingsWin = null;
let exerciseWin = null;

// ── 설정 저장/불러오기 (앱 전용 폴더에 settings.json으로 기억) ──
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
let settings = { intervalMinutes: 30, running: false, autoLaunch: false, panelOpacity: 85, peekEnabled: true, peekMinutes: 20, gender: 'f' };

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
  schedulePeek();
  if (!ticker) ticker = setInterval(check, 1000);
}

function stopTimer() {
  settings.running = false;
  saveSettings();
  targetTime = null;
  clearInterval(ticker);
  ticker = null;
  clearTimeout(peekTimer);
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

let trayIcon = null;
let spinFrames = [], spinTimer = null, spinIdx = 0;

// 체조 시간 동안 발레리나 피루엣 회전
function startTraySpin() {
  if (spinTimer || spinFrames.length === 0) return;
  spinTimer = setInterval(() => tray.setImage(spinFrames[spinIdx++ % spinFrames.length]), 500);
}
function stopTraySpin() {
  clearInterval(spinTimer);
  spinTimer = null;
  tray.setImage(trayIcon);
}

// ── 빼꼼 창: 20~30분마다 화면 아래에서 캐릭터가 올라옴 ──
let peekWin = null;
let peekTimer = null;

function schedulePeek() {
  clearTimeout(peekTimer);
  if (!settings.peekEnabled) return; // 설정에서 껐으면 안 나옴
  const base = settings.peekMinutes * 60 * 1000;
  const delay = base * (0.8 + Math.random() * 0.4); // 설정 간격 ±20% 랜덤
  peekTimer = setTimeout(openPeek, delay);
}

function openPeek() {
  // 체조 중이거나 이미 떠 있으면 이번 회차는 건너뛰고 다음 예약
  if ((exerciseWin && !exerciseWin.isDestroyed()) || (peekWin && !peekWin.isDestroyed())) {
    schedulePeek();
    return;
  }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea; // 마우스가 있는 화면 기준
  const edge = ['bottom', 'left', 'right', 'corner-left', 'corner-right'][Math.floor(Math.random() * 5)]; // 방향 랜덤 (위쪽은 없음)
  let W, H, x, y;
  if (edge === 'bottom') {
    W = 340; H = 430; // 말풍선 공간 포함
    x = area.x + Math.floor(Math.random() * (area.width - W));
    y = area.y + area.height - H;
  } else if (edge === 'left' || edge === 'right') {
    W = 420; H = 420;
    y = area.y + Math.floor(Math.random() * (area.height - H));
    x = edge === 'left' ? area.x : area.x + area.width - W;
  } else {
    // 아래 구석: 화면 모서리에 딱 붙임
    W = 480; H = 520;
    y = area.y + area.height - H;
    x = edge === 'corner-left' ? area.x : area.x + area.width - W;
  }
  peekWin = new BrowserWindow({
    width: W,
    height: H,
    x,
    y,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false, // 작업 중인 창의 포커스를 뺏지 않음
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  peekWin.loadFile('peek.html', { query: { edge } }); // 방향 전달
  peekWin.on('closed', schedulePeek); // 끝나면 다음 빼꼼 예약
}

ipcMain.handle('close-peek', () => {
  if (peekWin && !peekWin.isDestroyed()) peekWin.close();
  return { ok: true };
});

// ── 체조 창 (투명, 항상 위) ──
function openExercise() {
  if (exerciseWin && !exerciseWin.isDestroyed()) return;
  const eArea = screen.getPrimaryDisplay().workArea;
  exerciseWin = new BrowserWindow({
    width: 720,
    height: Math.min(1040, eArea.height - 20), // 화면보다 크면 화면에 맞춤
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
  startTraySpin();
  exerciseWin.on('closed', stopTraySpin);
}

// ── 설정 창 ──
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 320,
    height: 560,
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
ipcMain.handle('set-gender', (e, v) => {
  if (v === 'f' || v === 'm') { settings.gender = v; saveSettings(); } // 입력 검증
  return { ok: true };
});
ipcMain.handle('set-peek', (e, opt) => {
  settings.peekEnabled = !!opt.enabled;
  const m = Number(opt.minutes);
  if (Number.isFinite(m) && m >= 1 && m <= 240) settings.peekMinutes = m; // 입력 검증
  saveSettings();
  clearTimeout(peekTimer);
  if (targetTime !== null && settings.peekEnabled) schedulePeek();
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
  peekEnabled: settings.peekEnabled,
  peekMinutes: settings.peekMinutes,
  gender: settings.gender,
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

  // 요가 실루엣 템플릿 아이콘 (Mac이 라이트/다크 모드 색을 자동 전환)
  trayIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'yogaframe_0.png')); // 요가 차렷 자세, @2x 자동 인식
  trayIcon.setTemplateImage(true);
  for (let i = 0; i < 8; i++) {
    const f = nativeImage.createFromPath(path.join(__dirname, 'assets', `yogaframe_${i}.png`));
    f.setTemplateImage(true);
    spinFrames.push(f);
  }
  tray = new Tray(trayIcon);
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
