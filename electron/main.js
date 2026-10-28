const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

// Chống lỗi màn hình đen trên các máy khách dùng card onboard cũ, laptop 2 card (Optimus) hoặc VPS/RDP
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

let mainWindow = null;
const PORT = 3456;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

function checkServerAlive() {
  return new Promise((resolve) => {
    const req = http.get(SERVER_URL + '/api/status', (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1200, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function isDirWritable(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    const testFile = path.join(dirPath, `.test_${process.pid}`);
    fs.writeFileSync(testFile, '1');
    fs.unlinkSync(testFile);
    return true;
  } catch (_) {
    return false;
  }
}

function syncBackendFiles(bundledBackend, targetDir) {
  for (const f of ['server_ui.js', 'github_update_config.json', 'tao_video_cookie_sll.js', 'xoa_logo_sll.js']) {
    const src = path.join(bundledBackend, f);
    const dest = path.join(targetDir, f);
    try {
      if (!fs.existsSync(src)) continue;
      if (path.resolve(src) === path.resolve(dest)) continue;
      const shouldCopy = !fs.existsSync(dest) || (fs.statSync(src).mtimeMs > fs.statSync(dest).mtimeMs);
      if (shouldCopy) {
        fs.copyFileSync(src, dest);
      }
    } catch (_) {}
  }
}

function resolvePaths() {
  const bundledBackend = process.resourcesPath
    ? path.join(process.resourcesPath, 'app-backend')
    : path.resolve(__dirname, '..');

  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || '';

  // 1. Nếu chạy từ win-unpacked bên trong thư mục dự án D:\see byteplus\electron\dist\win-unpacked
  const parentProjectDir = path.resolve(process.execPath, '..', '..', '..', '..');
  if (
    fs.existsSync(path.join(parentProjectDir, 'server_ui.js')) &&
    fs.existsSync(path.join(parentProjectDir, 'cookies')) &&
    isDirWritable(parentProjectDir)
  ) {
    return {
      workDir: parentProjectDir,
      serverScript: path.join(parentProjectDir, 'server_ui.js'),
      ffmpegPath: fs.existsSync(path.join(parentProjectDir, 'bin', 'ffmpeg.exe'))
        ? path.join(parentProjectDir, 'bin', 'ffmpeg.exe')
        : path.join(bundledBackend, 'bin', 'ffmpeg.exe')
    };
  }

  // 2. Nếu chạy bản Portable.exe và thư mục chứa Portable.exe có quyền ghi
  if (portableDir && isDirWritable(portableDir)) {
    syncBackendFiles(bundledBackend, portableDir);
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

  // 3. Nếu chạy bản Setup.exe và bundledBackend có quyền ghi
  if (app.isPackaged && fs.existsSync(path.join(bundledBackend, 'server_ui.js')) && isDirWritable(bundledBackend)) {
    return {
      workDir: bundledBackend,
      serverScript: path.join(bundledBackend, 'server_ui.js'),
      ffmpegPath: path.join(bundledBackend, 'bin', 'ffmpeg.exe')
    };
  }

  // 4. Fallback an toàn 100% cho mọi máy khách (kể cả khi khách mở trực tiếp trong WinRAR hoặc ổ C bị khóa quyền)
  const safeUserDir = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.tmpdir(), 'GenCPU_Seedance_Studio');
  try { fs.mkdirSync(safeUserDir, { recursive: true }); } catch (_) {}
  syncBackendFiles(bundledBackend, safeUserDir);
  return {
    workDir: safeUserDir,
    serverScript: fs.existsSync(path.join(safeUserDir, 'server_ui.js'))
      ? path.join(safeUserDir, 'server_ui.js')
      : path.join(bundledBackend, 'server_ui.js'),
    ffmpegPath: path.join(bundledBackend, 'bin', 'ffmpeg.exe')
  };
}

function startEmbeddedBackend() {
  const { workDir, serverScript, ffmpegPath } = resolvePaths();

  process.env.NO_AUTO_OPEN_BROWSER = '1';
  process.env.SEEDANCE_PORT = String(PORT);
  process.env.SEEDANCE_ROOT_DIR = workDir;
  process.env.SEEDANCE_FFMPEG_PATH = ffmpegPath;

  global.__ELECTRON_RELAUNCH__ = () => {
    app.relaunch();
    app.exit(0);
  };

  try {
    process.chdir(workDir);
  } catch (_) {}

  try {
    // Chạy trực tiếp server_ui.js ngay bên trong tiến trình Electron (không cần spawn file .exe phụ nên không bao giờ bị Antivirus/Windows chặn)
    require(serverScript);
  } catch (err) {
    console.error('Backend start error:', err);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 840,
    minWidth: 1020,
    minHeight: 680,
    show: true,
    backgroundColor: '#0b0c10',
    title: 'GenCPU.com × GenPixo.com — Seedance AI Video Studio',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.show();
  mainWindow.focus();
  await mainWindow.loadFile(path.join(__dirname, 'splash.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      if (!url.includes(`127.0.0.1:${PORT}`) && !url.includes(`localhost:${PORT}`)) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    }
    return { action: 'allow' };
  });

  // Nếu trang web bị lỗi kết nối tạm thời, tự động nạp lại thay vì hiện màn hình đen
  mainWindow.webContents.on('did-fail-load', (_event, _errorCode, _errorDescription, validatedURL) => {
    if (validatedURL && validatedURL.startsWith('http://127.0.0.1')) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(SERVER_URL);
        }
      }, 700);
    }
  });

  let alive = await checkServerAlive();
  if (!alive) {
    startEmbeddedBackend();
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 150));
      alive = await checkServerAlive();
      if (alive) break;
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(SERVER_URL);
    mainWindow.show();
    mainWindow.focus();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
