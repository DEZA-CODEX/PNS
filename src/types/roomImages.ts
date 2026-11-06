export const ROOM_TYPES = ["vajra", "garuda", "arohana", "madhurya", "maayukha"] as const;

export type RoomType = (typeof ROOM_TYPES)[number];

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  vajra: "Vajra",
  garuda: "Garuda",
  arohana: "Arohana",
  madhurya: "Madhurya",
  maayukha: "Maayukha",
};

export const ROOM_IMAGE_DESTINATIONS = ["homepage", "roomsPage", "gallery"] as const;

export type RoomImageDestination = (typeof ROOM_IMAGE_DESTINATIONS)[number];

export type RoomImageSelections = Record<RoomImageDestination, boolean>;

export type RoomImage = {
  id: string;
  roomType: RoomType;
  filename: string;
  storageKey: string;
  url: string;
  altText: string;
  displayOrder: number;
  active: boolean;
  selections: RoomImageSelections;
};

export type RoomImageLoadResult = {
  images: RoomImage[];
  warnings: string[];
};

export type RoomImageSettingsRecord = {
  roomType: RoomType;
  selections: RoomImageSelections;
  displayOrder: number;
};

export type RoomImageRepository = {
  listImages(endpoint?: string): Promise<RoomImageLoadResult>;
  updateSelection(
    imageId: string,
    destination: RoomImageDestination,
    selected: boolean,
  ): Promise<RoomImageLoadResult>;
  subscribe(listener: () => void): () => void;
};

export class RoomImageRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoomImageRepositoryError";
  }
}

export class RoomImageValidationError extends RoomImageRepositoryError {
  constructor(message: string) {
    super(message);
    this.name = "RoomImageValidationError";
  }
}

export const DINING_TYPES = ["vrindavan", "cloud9", "clinq"] as const;

export type DiningType = (typeof DINING_TYPES)[number];

export const DINING_TYPE_LABELS: Record<DiningType, string> = {
  vrindavan: "Vrindavan",
  cloud9: "Cloud 9",
  clinq: "Clinq",
};

export const DINING_IMAGE_DESTINATIONS = [
  "homepage",
  "diningPage",
  "diningHero",
  "aboutPage",
  "gallery",
] as const;

export type DiningImageDestination = (typeof DINING_IMAGE_DESTINATIONS)[number];
export type DiningImageSelections = Record<DiningImageDestination, boolean>;
export type DiningDisplayDestination = Extract<DiningImageDestination, "diningPage" | "diningHero">;
export type DiningDisplayCounts = Record<DiningDisplayDestination, 1 | 2 | 3>;

export type DiningImage = {
  id: string;
  diningType: DiningType;
  filename: string;
  storageKey: string;
  url: string;
  altText: string;
  displayOrder: number;
  active: boolean;
  selections: DiningImageSelections;
};

export type DiningImageLoadResult = {
  images: DiningImage[];
  warnings: string[];
  displayCounts: Record<DiningType, DiningDisplayCounts>;
};

export type DiningImageRepository = {
  listImages(endpoint?: string): Promise<DiningImageLoadResult>;
  listAboutImages(): Promise<DiningImageLoadResult>;
  updateSelection(
    imageId: string,
    destination: DiningImageDestination,
    selected: boolean,
  ): Promise<DiningImageLoadResult>;
  updateDisplayCount(
    diningType: DiningType,
    destination: DiningDisplayDestination,
    count: 1 | 2 | 3,
  ): Promise<DiningImageLoadResult>;
  updateDisplayOrder(imageId: string, displayOrder: number): Promise<DiningImageLoadResult>;
  reportUnavailable(imageId: string): void;
  subscribe(listener: () => void): () => void;
};

export class DiningImageValidationError extends RoomImageRepositoryError {
  constructor(message: string) {
    super(message);
    this.name = "DiningImageValidationError";
  }
}
