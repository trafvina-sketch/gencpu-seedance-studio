const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

let mainWindow = null;
let serverProcess = null;
let isQuitting = false;
const PORT = 3456;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

function checkServerAlive() {
  return new Promise((resolve) => {
    const req = http.get(SERVER_URL + '/api/status', (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function resolvePaths() {
  const bundledBackend = process.resourcesPath
    ? path.join(process.resourcesPath, 'app-backend')
    : path.resolve(__dirname, '..');

  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || '';

  // Nếu chạy bản Portable.exe, lưu dữ liệu & code cập nhật ngay tại thư mục chứa file Portable.exe để không bị mất khi tắt app
  if (portableDir && fs.existsSync(portableDir)) {
    for (const f of ['server_ui.js', 'github_update_config.json', 'tao_video_cookie_sll.js', 'xoa_logo_sll.js']) {
      const src = path.join(bundledBackend, f);
      const dest = path.join(portableDir, f);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        try { fs.copyFileSync(src, dest); } catch (_) {}
      }
    }
    const ffmpegCand = fs.existsSync(path.join(portableDir, 'bin', 'ffmpeg.exe'))
      ? path.join(portableDir, 'bin', 'ffmpeg.exe')
      : path.join(bundledBackend, 'bin', 'ffmpeg.exe');

    const activeServerScript = fs.existsSync(path.join(portableDir, 'server_ui.js'))
      ? path.join(portableDir, 'server_ui.js')
      : path.join(bundledBackend, 'server_ui.js');

    return {
      workDir: portableDir,
      serverScript: activeServerScript,
      ffmpegPath: ffmpegCand
    };
  }

  // Nếu chạy bản Setup.exe (NSIS cài vào AppData\Local\Programs\...) hoặc chạy Dev
  if (app.isPackaged && fs.existsSync(path.join(bundledBackend, 'server_ui.js'))) {
    return {
      workDir: bundledBackend,
      serverScript: path.join(bundledBackend, 'server_ui.js'),
      ffmpegPath: path.join(bundledBackend, 'bin', 'ffmpeg.exe')
    };
  }

  const devRoot = path.resolve(__dirname, '..');
  return {
    workDir: devRoot,
    serverScript: path.join(devRoot, 'server_ui.js'),
    ffmpegPath: path.join(devRoot, 'bin', 'ffmpeg.exe')
  };
}

function startNodeBackend() {
  if (isQuitting) return;
  const { workDir, serverScript, ffmpegPath } = resolvePaths();

  const env = Object.assign({}, process.env, {
    ELECTRON_RUN_AS_NODE: '1',
    NO_AUTO_OPEN_BROWSER: '1',
    SEEDANCE_PORT: String(PORT),
    SEEDANCE_ROOT_DIR: workDir,
    SEEDANCE_FFMPEG_PATH: ffmpegPath
  });

  try {
    serverProcess = spawn(process.execPath, [serverScript], {
      cwd: workDir,
      env,
      stdio: 'ignore',
      detached: false,
      windowsHide: true
    });

    serverProcess.on('exit', () => {
      serverProcess = null;
      // Tự động khởi động lại backend ngay sau khi người dùng bấm "Cập nhật GitHub"
      if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
        setTimeout(() => {
          if (!isQuitting) startNodeBackend();
        }, 500);
      }
    });
  } catch (err) {
    console.error('Failed to start backend:', err);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 840,
    minWidth: 1020,
    minHeight: 680,
    backgroundColor: '#0b0c10',
    title: 'GenCPU.com × GenPixo.com — Seedance AI Video Studio',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'splash.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      if (!url.includes(`127.0.0.1:${PORT}`) && !url.includes(`localhost:${PORT}`)) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    }
    return { action: 'allow' };
  });

  let alive = await checkServerAlive();
  if (!alive) {
    startNodeBackend();
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 250));
      alive = await checkServerAlive();
      if (alive) break;
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(SERVER_URL);
  }
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    isQuitting = true;
    if (serverProcess) {
      try {
        spawn('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t'], { windowsHide: true });
      } catch (_) {}
      serverProcess = null;
    }
    app.quit();
  });
}
