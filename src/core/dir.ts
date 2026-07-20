/**
 * Direction constants and per-direction deltas, matching URoom.pas:
 *   dir_no=0, dir_up=1, dir_down=2, dir_left=3, dir_right=4
 *   dx_dir=(0,0,0,-1,1)  dy_dir=(0,-1,1,0,0)   (URoom.pas:62-63)
 */
export const Dir = {
  no: 0,
  up: 1,
  down: 2,
  left: 3,
  right: 4,
} as const;
export type DirValue = (typeof Dir)[keyof typeof Dir];

export const DX_DIR: readonly number[] = [0, 0, 0, -1, 1];
export const DY_DIR: readonly number[] = [0, -1, 1, 0, 0];
