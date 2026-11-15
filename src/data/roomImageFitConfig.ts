export type RoomImageFitMode = "cover" | "contain" | "fill";

export type RoomImageFit = {
  fitMode: RoomImageFitMode;
  zoom: number;
  positionX: number;
  positionY: number;
};

export const DEFAULT_ROOM_IMAGE_FIT: RoomImageFit = {
  fitMode: "cover",
  zoom: 1,
  positionX: 50,
  positionY: 50,
};

// Add overrides by RoomImage.storageKey to tune individual room photos.
export const ROOM_IMAGE_FIT_OVERRIDES: Partial<Record<string, RoomImageFit>> = {};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getRoomImageFit(storageKey: string): RoomImageFit {
  const fit = ROOM_IMAGE_FIT_OVERRIDES[storageKey] ?? DEFAULT_ROOM_IMAGE_FIT;
  return {
    fitMode: fit.fitMode,
    zoom: clamp(fit.zoom, 0.5, 2.5),
    positionX: clamp(fit.positionX, 0, 100),
    positionY: clamp(fit.positionY, 0, 100),
  };
}
