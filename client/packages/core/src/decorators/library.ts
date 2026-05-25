import { registerLibrary, type LibraryInfo } from '../core/hooks.js';

export function Library(info: LibraryInfo): ClassDecorator {
  return (target) => {
    registerLibrary(target as any, info);
  };
}

