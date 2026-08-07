/** 办公室漫游：预设机位 + 可走范围 */

export type OfficeViewId = "overview" | "desk" | "board" | "server" | "shelf" | "walk";

export const OFFICE_VIEWS: Record<
  Exclude<OfficeViewId, "walk">,
  {
    label: string;
    position: [number, number, number];
    target: [number, number, number];
  }
> = {
  overview: {
    label: "全景",
    position: [3.8, 2.9, 5.4],
    target: [0.3, 1.2, 0],
  },
  desk: {
    label: "工位",
    position: [0.2, 1.55, 2.6],
    target: [0.1, 1.25, -0.2],
  },
  board: {
    label: "黑板",
    position: [1.2, 1.9, -1.8],
    target: [0.2, 2.4, -4.5],
  },
  server: {
    label: "机架",
    position: [2.2, 1.6, 2.8],
    target: [4.0, 1.2, 1.6],
  },
  shelf: {
    label: "书架",
    position: [2.4, 1.7, -1.2],
    target: [4.5, 1.4, -2.6],
  },
};

/** 房间可行走边界（与 RoomShell 尺寸对齐） */
export const WALK_BOUNDS = {
  minX: -4.2,
  maxX: 4.2,
  minZ: -3.6,
  maxZ: 3.8,
  y: 1.55,
};
