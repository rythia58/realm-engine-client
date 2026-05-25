import { existsSync, copyFileSync, unlinkSync, renameSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { ExaltFinder } from './ExaltFinder.js';
import { Logger } from '../util/Logger.js';

const DLL_NAME = 'winhttp.dll';
const BACKUP_NAME = 'winhttp.dll.bak';

function fileSha256(path: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

export class GameHooker {
  private gamePath: string | null = null;
  private dllTarget: string = '';
  private backupPath: string = '';
  private installed = false;
  private assetsDir: string;

  constructor(preferredGamePath: string | null = null, assetsDir?: string) {
    this.preferredGamePath = preferredGamePath;
    if (assetsDir) {
      this.assetsDir = assetsDir;
    } else {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      this.assetsDir = resolve(__dirname, '..', '..', 'assets');
    }
  }

  private preferredGamePath: string | null;

  private isValidExaltDir(dir: string | null | undefined): dir is string {
    const value = String(dir || '').trim();
    if (!value) return false;
    try {
      return existsSync(value) && existsSync(join(value, 'RotMG Exalt.exe'));
    } catch {
      return false;
    }
  }

  private resolveGamePath(): string | null {
    if (this.isValidExaltDir(this.preferredGamePath)) {
      Logger.log('GameHooker', `Using configured Exalt path: ${this.preferredGamePath}`);
      return this.preferredGamePath;
    }
    return ExaltFinder.find();
  }

  /**
   * Install the proxy DLL into the Exalt game directory.
   * - Auto-detects Exalt path
   * - Backs up existing winhttp.dll if present
   * - Copies our hook DLL into the game directory
   */
  async install(): Promise<boolean> {
    // Find game directory
    this.gamePath = this.resolveGamePath();
    if (!this.gamePath) {
      Logger.error('GameHooker', 'Cannot install hook: Exalt directory not found.');
      Logger.error('GameHooker', 'The proxy will still run, but you must manually redirect connections to 127.0.0.1:2050.');
      return false;
    }

    if (process.env.REALM_ENGINE_SKIP_WINHTTP_INSTALL === '1') {
      Logger.warn(
        'GameHooker',
        'Skipping winhttp.dll install (REALM_ENGINE_SKIP_WINHTTP_INSTALL=1). Remove game folder winhttp.dll manually if a prior run left it there.',
      );
      this.installed = false;
      return false;
    }

    // #region agent log
    // #endregion

    // Check if our DLL asset exists
    const sourceDll = join(this.assetsDir, DLL_NAME);
    if (!existsSync(sourceDll)) {
      Logger.error('GameHooker', `Hook DLL not found at ${sourceDll}`);
      Logger.error('GameHooker', 'Run native/build.bat from a Developer Command Prompt to compile it.');
      Logger.error('GameHooker', 'The proxy will still run, but connections won\'t be automatically redirected.');
      return false;
    }

    this.dllTarget = join(this.gamePath, DLL_NAME);
    this.backupPath = join(this.gamePath, BACKUP_NAME);

    // Back up existing DLL if present (could be from a previous session or another tool)
    if (existsSync(this.dllTarget)) {
      // Compare hash to avoid false positives from same-size non-matching DLLs.
      try {
        const { statSync } = await import('fs');
        const sourceSize = statSync(sourceDll).size;
        const targetSize = statSync(this.dllTarget).size;
        const sourceHash = fileSha256(sourceDll);
        const targetHash = fileSha256(this.dllTarget);
        // #region agent log
        // #endregion
        if (sourceHash !== null && targetHash !== null && sourceHash === targetHash) {
          Logger.log('GameHooker', 'Hook DLL already installed (hash match), skipping.');
          this.installed = true;
          return true;
        }
      } catch { /* proceed with backup */ }

      Logger.log('GameHooker', `Backing up existing ${DLL_NAME} to ${BACKUP_NAME}`);
      try {
        renameSync(this.dllTarget, this.backupPath);
      } catch (err) {
        Logger.error('GameHooker', `Failed to backup existing DLL: ${err}`);
        Logger.error('GameHooker', 'Is the game currently running? Close it and try again.');
        return false;
      }
    }

    // Copy our hook DLL
    try {
      copyFileSync(sourceDll, this.dllTarget);
      this.installed = true;
      Logger.log('GameHooker', `Hook DLL installed to ${this.dllTarget}`);
      Logger.log('GameHooker', 'Game will redirect port 2050 connections to the proxy.');
      // #region agent log
      // #endregion
      return true;
    } catch (err) {
      Logger.error('GameHooker', `Failed to install hook DLL: ${err}`);
      return false;
    }
  }

  /**
   * Remove the proxy DLL from the game directory and restore backup if any.
   */
  async uninstall(): Promise<void> {
    if (!this.installed || !this.gamePath) return;

    try {
      // Remove our DLL
      if (existsSync(this.dllTarget)) {
        unlinkSync(this.dllTarget);
        Logger.log('GameHooker', `Removed hook DLL from ${this.dllTarget}`);
      }

      // Restore backup if exists
      if (existsSync(this.backupPath)) {
        renameSync(this.backupPath, this.dllTarget);
        Logger.log('GameHooker', 'Restored original winhttp.dll from backup.');
      }

      this.installed = false;
    } catch (err) {
      Logger.error('GameHooker', `Error during uninstall: ${err}`);
    }
  }

  get isInstalled(): boolean {
    return this.installed;
  }

  get gameDirectory(): string | null {
    return this.gamePath;
  }
}
