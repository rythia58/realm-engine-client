export enum LogLevel {
  Debug = 10,
  Info = 20,
  Warning = 30,
  Error = 40
}

export class Logger {
  static minLevel: LogLevel = LogLevel.Info;

  static setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  static log(scope: string, msg: string, level: LogLevel = LogLevel.Info): void {
    if (level < this.minLevel) return;
    const prefix = `[${scope}]`;
    // eslint-disable-next-line no-console
    console.log(prefix, msg);
  }
}

