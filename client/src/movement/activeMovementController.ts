import type { MovementController } from './MovementController.js';

/** Shared singleton set by BridgeWalking.install() — used by BridgeWorld for enterRealm(). */
export let activeController: MovementController | null = null;

export function setActiveController(c: MovementController): void {
  activeController = c;
}
