'use strict';

// Auto-update via electron-updater against the Realm Engine release API.
//
// The bot-api backend already exposes an electron-updater "generic" feed:
//   GET https://api.realmengine.org/api/releases/win/latest.yml   (manifest)
//   GET https://api.realmengine.org/api/releases/win/<filename>    (302 -> S3)
// The feed/channel is configured in electron-builder.json `publish`, which
// electron-builder embeds as app-update.yml inside the packaged app.
//
// Two entry points:
//   1. enforceUpdateOnLaunch — called BEFORE the main window opens. Fetches
//      `/api/releases/min-version` (operator-controlled, set in the admin
//      panel). If the running app is below that floor, blocks startup behind a
//      non-dismissible splash that downloads + installs the latest release.
//      Otherwise lets startup proceed.
//   2. scheduleBackgroundUpdateChecks — called AFTER the main window is open.
//      Periodically polls the updater feed and soft-prompts users when an
//      update is published mid-session ("Restart now / Later"). The hard gate
//      on next launch is what guarantees a stale version actually goes away.

const API_BASE = 'https://api.realmengine.org';
const MIN_VERSION_FETCH_TIMEOUT_MS = 5000;
const LAUNCH_CHECK_TIMEOUT_MS = 8000;
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let backgroundChecksStarted = false;

function loadAutoUpdater() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = {
      info: (m) => console.log('[updater]', m),
      warn: (m) => console.warn('[updater]', m),
      error: (m) => console.error('[updater]', m),
      debug: () => {},
    };
    return autoUpdater;
  } catch (err) {
    console.warn('[updater] electron-updater not available:', err && err.message);
    return null;
  }
}

// Lightweight semver compare — handles "1.2.3" + pre-release suffixes (which
// we just strip for the comparison). Returns negative if a < b, 0 if equal,
// positive if a > b. Falls back to 0 on parse failure so we fail-open rather
// than locking users out over a malformed version string.
function compareSemver(a, b) {
  try {
    const parse = (s) =>
      String(s).split('+')[0].split('-')[0].split('.').map((p) => parseInt(p, 10) || 0);
    const av = parse(a);
    const bv = parse(b);
    const len = Math.max(av.length, bv.length, 3);
    for (let i = 0; i < len; i++) {
      const ai = av[i] || 0;
      const bi = bv[i] || 0;
      if (ai !== bi) return ai - bi;
    }
    return 0;
  } catch (_) {
    return 0;
  }
}

async function fetchMinClientVersion() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MIN_VERSION_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/releases/min-version`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json && typeof json.min_version === 'string' && json.min_version.trim()) {
      return json.min_version.trim();
    }
    return null;
  } catch (err) {
    console.warn('[updater] min-version fetch failed:', err && err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function splashHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#0f1115;color:#e7e9ee;font-family:-apple-system,Segoe UI,sans-serif;overflow:hidden;user-select:none;-webkit-user-select:none}
    .wrap{padding:28px 32px}
    h1{font-size:15px;font-weight:600;margin:0 0 6px}
    p{font-size:12px;color:#9aa3b2;margin:0 0 18px;min-height:16px}
    .bar{background:#23262e;border-radius:3px;height:6px;overflow:hidden}
    .fill{background:linear-gradient(90deg,#4a9eff,#6cc1ff);height:100%;width:0%;transition:width .25s ease}
    .pct{font-size:11px;color:#6b7280;margin-top:10px;font-variant-numeric:tabular-nums}
    .err{color:#ff7b7b;font-size:11px;margin-top:14px;display:none}
  </style></head><body><div class="wrap">
    <h1>Updating Realm Engine</h1>
    <p id="msg">Preparing update&hellip;</p>
    <div class="bar"><div class="fill" id="fill"></div></div>
    <div class="pct" id="pct"></div>
    <div class="err" id="err"></div>
  </div></body></html>`;
}

function openSplash(BrowserWindow) {
  const win = new BrowserWindow({
    width: 420,
    height: 180,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#0f1115',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml()));
  win.once('ready-to-show', () => win.show());
  return win;
}

function updateSplash(win, { message, percent, error }) {
  if (!win || win.isDestroyed()) return;
  const safe = (s) => String(s == null ? '' : s).replace(/[\\'"\n\r<>]/g, (c) => ({
    '\\': '\\\\', "'": "\\'", '"': '\\"', '\n': '\\n', '\r': '', '<': '&lt;', '>': '&gt;',
  })[c]);
  const js = [];
  if (message != null) js.push(`document.getElementById('msg').textContent='${safe(message)}';`);
  if (percent != null) {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    js.push(`document.getElementById('fill').style.width='${p}%';`);
    js.push(`document.getElementById('pct').textContent='${p}%';`);
  }
  if (error != null) {
    js.push(`var e=document.getElementById('err');e.style.display='block';e.textContent='${safe(error)}';`);
  }
  win.webContents.executeJavaScript(js.join(''), true).catch(() => {});
}

function showFatalAndQuit(dialog, app, splash, message) {
  try { if (splash && !splash.isDestroyed()) splash.destroy(); } catch (_) {}
  try {
    dialog.showMessageBoxSync({
      type: 'error',
      buttons: ['Quit'],
      defaultId: 0,
      title: 'Realm Engine update required',
      message: 'Update required',
      detail: message,
    });
  } catch (_) {}
  app.exit(1);
}

/**
 * Block startup until either (a) the running version is at/above the
 * server-configured minimum (proceed), (b) an update is installed (app
 * quits), or (c) we can't reach the policy endpoint at all (proceed —
 * server-side auth gate is the actual lock).
 *
 * @param {object} opts
 * @param {import('electron').App} opts.app
 * @param {typeof import('electron').BrowserWindow} opts.BrowserWindow
 * @param {import('electron').Dialog} opts.dialog
 * @returns {Promise<{ updating: boolean }>}
 *   updating=true means the app is about to quit-and-install; caller MUST NOT
 *   open the main window. updating=false means proceed with normal startup.
 */
async function enforceUpdateOnLaunch({ app, BrowserWindow, dialog }) {
  if (!app.isPackaged) {
    console.log('[updater] launch gate skipped — not a packaged build (dev mode)');
    return { updating: false };
  }

  const currentVersion = app.getVersion();
  const minVersion = await fetchMinClientVersion();

  if (!minVersion) {
    console.log('[updater] no min-version policy from server — allowing startup');
    return { updating: false };
  }

  const belowMin = compareSemver(currentVersion, minVersion) < 0;
  console.log(`[updater] current=${currentVersion} min=${minVersion} belowMin=${belowMin}`);

  if (!belowMin) {
    return { updating: false };
  }

  // We're below min — force an update. Failure modes here are fatal: server
  // policy says this version can't run, so we don't fall back to launching.
  const autoUpdater = loadAutoUpdater();
  if (!autoUpdater) {
    showFatalAndQuit(dialog, app, null,
      `Your Realm Engine version (v${currentVersion}) is no longer supported. ` +
      `Minimum required: v${minVersion}.\n\nThe auto-updater is unavailable in this build. ` +
      `Please reinstall from realmengine.org.`);
    return { updating: true };
  }

  return new Promise((resolve) => {
    let settled = false;
    let splash = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (!result.updating) {
        try { if (splash && !splash.isDestroyed()) splash.destroy(); } catch (_) {}
      }
      resolve(result);
    };

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    const timer = setTimeout(() => {
      if (!splash) {
        showFatalAndQuit(dialog, app, null,
          `Realm Engine could not reach the update server.\n\n` +
          `Your version (v${currentVersion}) is below the minimum required (v${minVersion}). ` +
          `Check your internet connection and try again.`);
        finish({ updating: true });
      }
    }, LAUNCH_CHECK_TIMEOUT_MS);

    autoUpdater.on('update-not-available', (info) => {
      clearTimeout(timer);
      const latest = (info && info.version) || 'unknown';
      showFatalAndQuit(dialog, app, splash,
        `Your Realm Engine version (v${currentVersion}) is no longer supported. ` +
        `Minimum required: v${minVersion}, but the latest published release is v${latest}.\n\n` +
        `Please contact support — the server is misconfigured.`);
      finish({ updating: true });
    });

    autoUpdater.on('update-available', (info) => {
      clearTimeout(timer);
      const version = (info && info.version) || 'latest';
      // Defensive: the published latest must also clear the min bar, otherwise
      // we'd download a release that gets force-updated again next launch.
      if (compareSemver(version, minVersion) < 0) {
        showFatalAndQuit(dialog, app, splash,
          `Realm Engine v${currentVersion} requires an update to v${minVersion} or newer, ` +
          `but the latest published release (v${version}) is also below the minimum.\n\n` +
          `Please contact support — the server is misconfigured.`);
        finish({ updating: true });
        return;
      }
      console.log('[updater] forcing update to v' + version);
      splash = openSplash(BrowserWindow);
      updateSplash(splash, { message: `Downloading v${version}…`, percent: 0 });
      autoUpdater.downloadUpdate().catch((err) => {
        console.error('[updater] downloadUpdate failed:', err && err.message);
        showFatalAndQuit(dialog, app, splash,
          'Realm Engine could not download the required update.\n\n' +
          'Check your internet connection and try again.');
        finish({ updating: true });
      });
    });

    autoUpdater.on('download-progress', (p) => {
      if (splash) updateSplash(splash, { percent: p && p.percent });
    });

    autoUpdater.on('update-downloaded', (info) => {
      const version = (info && info.version) || 'latest';
      if (splash) updateSplash(splash, { message: `Installing v${version}…`, percent: 100 });
      // isSilent=false (show NSIS progress), isForceRunAfter=true (reopen after install)
      setImmediate(() => {
        try { autoUpdater.quitAndInstall(false, true); } catch (err) {
          console.error('[updater] quitAndInstall failed:', err && err.message);
        }
      });
      finish({ updating: true });
    });

    autoUpdater.on('error', (err) => {
      console.error('[updater] check error:', err && (err.message || err));
      clearTimeout(timer);
      const detail = (err && err.message) || String(err);
      showFatalAndQuit(dialog, app, splash,
        `Realm Engine v${currentVersion} requires v${minVersion} or newer, ` +
        `but updating failed:\n\n${detail}\n\nCheck your internet and relaunch.`);
      finish({ updating: true });
    });

    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] checkForUpdates threw:', err && err.message);
      clearTimeout(timer);
      showFatalAndQuit(dialog, app, splash,
        `Realm Engine could not check for updates.\n\n` +
        `Your version (v${currentVersion}) is below the minimum required (v${minVersion}). ` +
        `Check your internet connection and try again.`);
      finish({ updating: true });
    });
  });
}

/**
 * Periodic soft-prompt update check for long-running sessions. Users at/above
 * the min-version floor still benefit from being told a new build is out so
 * they can take it now rather than getting hard-gated whenever the operator
 * bumps the floor.
 */
function scheduleBackgroundUpdateChecks({ app, dialog, getWindow }) {
  if (backgroundChecksStarted) return;
  if (!app.isPackaged) return;
  const autoUpdater = loadAutoUpdater();
  if (!autoUpdater) return;
  backgroundChecksStarted = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    const win = (typeof getWindow === 'function' && getWindow()) || null;
    const version = (info && info.version) || 'the latest version';
    const opts = {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Realm Engine update ready',
      message: `Realm Engine v${version} has been downloaded.`,
      detail: 'Restart now to install, or it will be applied automatically the next time you close Realm Engine.',
    };
    const choose = win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
    Promise.resolve(choose).then((res) => {
      if (res && res.response === 0) {
        setImmediate(() => autoUpdater.quitAndInstall(false, true));
      }
    }).catch(() => {});
  });

  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, PERIODIC_CHECK_INTERVAL_MS);
}

module.exports = { enforceUpdateOnLaunch, scheduleBackgroundUpdateChecks };
