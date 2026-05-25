/** PyRelay `Constants/ClassIds` — playable classes (for discovering own player in UPDATE). */
export const WIZARD_CLASS_ID = 782;

export const PLAYER_CLASS_TYPE_IDS: ReadonlySet<number> = new Set([
  768, 775, 782, 784, 785, 796, 797, 798, 799, 800, 801, 802, 803, 804, 805, 806, 817, 818
]);

export function isPlayerObjectType(objectType: number): boolean {
  return PLAYER_CLASS_TYPE_IDS.has(objectType);
}
