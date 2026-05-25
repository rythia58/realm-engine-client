import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Logger } from '../util/Logger.js';

const EXALT_EXE = 'RotMG Exalt.exe';

export class ExaltFinder {
  /**
   * Auto-detect the RotMG Exalt installation directory.
   * Search order:
   *   1. ROTMG_PATH environment variable
   *   2. AppData\Local\RealmOfTheMadGod\Production (actual exe location)
   *   3. Documents\RealmOfTheMadGod\Production (legacy/alt location)
   *   4. Steam common apps paths
   */
  static find(): string | null {
    // 1. Environment variable override
    const envPath = process.env.ROTMG_PATH;
    if (envPath && ExaltFinder.isValidExaltDir(envPath)) {
      Logger.log('ExaltFinder', `Found Exalt via ROTMG_PATH: ${envPath}`);
      return envPath;
    }

    const home = homedir();

    // 2. AppData\Local — this is where the exe actually runs from
    const appDataLocal = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    const appDataPath = join(appDataLocal, 'RealmOfTheMadGod', 'Production');
    if (ExaltFinder.isValidExaltDir(appDataPath)) {
      Logger.log('ExaltFinder', `Found Exalt at: ${appDataPath}`);
      return appDataPath;
    }

    // 3. Documents folder (legacy/alt location)
    const documentsPath = join(home, 'Documents', 'RealmOfTheMadGod', 'Production');
    if (ExaltFinder.isValidExaltDir(documentsPath)) {
      Logger.log('ExaltFinder', `Found Exalt at: ${documentsPath}`);
      return documentsPath;
    }

    // 4. Steam common apps (RotMG Exalt folder name) + LoginGUI-style "Realm of the Mad God" and C:\Games
    const steamPaths = [
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RotMG Exalt',
      'C:\\Program Files\\Steam\\steamapps\\common\\RotMG Exalt',
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Realm of the Mad God',
      'C:\\Program Files\\Steam\\steamapps\\common\\Realm of the Mad God',
      'C:\\Games\\Realm of the Mad God',
      'D:\\Steam\\steamapps\\common\\RotMG Exalt',
      'D:\\SteamLibrary\\steamapps\\common\\RotMG Exalt',
      'E:\\Steam\\steamapps\\common\\RotMG Exalt',
      'E:\\SteamLibrary\\steamapps\\common\\RotMG Exalt',
    ];

    for (const steamPath of steamPaths) {
      if (ExaltFinder.isValidExaltDir(steamPath)) {
        Logger.log('ExaltFinder', `Found Exalt via Steam: ${steamPath}`);
        return steamPath;
      }
    }

    Logger.warn('ExaltFinder', 'Could not auto-detect Exalt installation.');
    Logger.warn('ExaltFinder', 'Set the ROTMG_PATH environment variable to your Exalt directory.');
    Logger.warn('ExaltFinder', `Expected to find ${EXALT_EXE} in the directory.`);
    return null;
  }

  private static isValidExaltDir(dir: string): boolean {
    try {
      return existsSync(dir) && existsSync(join(dir, EXALT_EXE));
    } catch {
      return false;
    }
  }
}
