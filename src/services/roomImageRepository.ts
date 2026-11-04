import { roomCategories } from "@/data/rooms";
import { diningImageAssets, roomImageAssets } from "@/lib/asset-manifest";
import {
  ROOM_IMAGE_DESTINATIONS,
  ROOM_TYPE_LABELS,
  ROOM_TYPES,
  DINING_IMAGE_DESTINATIONS,
  DINING_TYPE_LABELS,
  DINING_TYPES,
  DiningImageValidationError,
  RoomImageRepositoryError,
  RoomImageValidationError,
  type DiningDisplayCounts,
  type DiningDisplayDestination,
  type DiningImage,
  type DiningImageDestination,
  type DiningImageLoadResult,
  type DiningImageRepository,
  type DiningImageSelections,
  type DiningType,
  type RoomImage,
  type RoomImageDestination,
  type RoomImageLoadResult,
  type RoomImageRepository,
  type RoomImageSelections,
  type RoomImageSettingsRecord,
  type RoomType,
} from "@/types/roomImages";
import { apiFetch, apiResourceUrl } from "@/lib/api-client";

export type BundledManagedImage = {
  id: string;
  category: string;
  url: string;
  path: string;
  sourceType: "bundled";
  filename: string;
  displayLocation: string;
  displayOrder: number;
  active: boolean;
};

const STORAGE_KEY = "pns-room-images:v1";
const SCHEMA_VERSION = 1;
const DEFAULT_SELECTIONS: RoomImageSelections = {
  homepage: true,
  roomsPage: true,
  gallery: true,
};

const discoveredAssets = roomImageAssets;

type PersistedSettings = {
  version: number;
  images: Record<string, RoomImageSettingsRecord>;
};

function isRoomType(value: unknown): value is RoomType {
  return typeof value === "string" && ROOM_TYPES.includes(value as RoomType);
}

function isSelection(value: unknown): value is RoomImageSelections {
  if (!value || typeof value !== "object") return false;
  const selections = value as Record<string, unknown>;
  return ROOM_IMAGE_DESTINATIONS.every(
    (destination) => typeof selections[destination] === "boolean",
  );
}

function roomTypeForAssetPath(path: string): RoomType | null {
  const match = path.match(/\/rooms\/([^/]+)\//);
  return match && isRoomType(match[1]) ? match[1] : null;
}

function createDiscoveredImages(): RoomImage[] {
  const images = Object.entries(discoveredAssets)
    .map<RoomImage | null>(([path, url]) => {
      const roomType = roomTypeForAssetPath(path);
      if (!roomType) return null;

      const filename = path.split("/").pop() ?? path;
      const storageKey = path.replace(/^\/src\/assets\/rooms\//, "");
      const identity = storageKey.toLowerCase();
      const roomName = roomCategories.find((room) => room.id === roomType)?.name ?? roomType;

      return {
        id: `${roomType}:${identity}`,
        roomType,
        filename,
        storageKey,
        url,
        altText: `${roomName} room at Hotel PNS Nakshatra`,
        displayOrder: 0,
        active: true,
        selections: { ...DEFAULT_SELECTIONS },
      } satisfies RoomImage;
    })
    .filter((image): image is RoomImage => image !== null)
    .sort((left, right) => left.storageKey.localeCompare(right.storageKey));

  const ids = new Set<string>();
  for (const image of images) {
    if (ids.has(image.id)) {
      throw new RoomImageRepositoryError(`Duplicate room image ID discovered: ${image.id}`);
    }
    ids.add(image.id);
  }

  return images;
}

function readPersistedSettings(): {
  records: Record<string, RoomImageSettingsRecord>;
  warnings: string[];
} {
  const warnings: string[] = [];
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return {
      records: {},
      warnings: ["Browser storage is unavailable; default image selections are being used."],
    };
  }

  if (!stored) return { records: {}, warnings };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return {
      records: {},
      warnings: ["Saved room-image settings were invalid and have been reset to defaults."],
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      records: {},
      warnings: ["Saved room-image settings were invalid and have been reset to defaults."],
    };
  }

  const saved = parsed as Partial<PersistedSettings>;
  if (saved.version !== SCHEMA_VERSION || !saved.images || typeof saved.images !== "object") {
    return {
      records: {},
      warnings: [
        "Saved room-image settings used an unsupported format and have been reset to defaults.",
      ],
    };
  }

  const records: Record<string, RoomImageSettingsRecord> = {};
  for (const [id, value] of Object.entries(saved.images)) {
    if (
      !value ||
      typeof value !== "object" ||
      !isRoomType(value.roomType) ||
      !isSelection(value.selections) ||
      !Number.isInteger(value.displayOrder) ||
      value.displayOrder < 0
    ) {
      warnings.push(
        `Saved settings for ${id} were invalid; defaults are being used for that image.`,
      );
      continue;
    }
    records[id] = value;
  }

  return { records, warnings };
}

function isDestinationValid(
  images: RoomImage[],
  roomType: RoomType,
  destination: RoomImageDestination,
) {
  return images.some(
    (image) => image.roomType === roomType && image.active && image.selections[destination],
  );
}

function validateMinimumSelections(images: RoomImage[]) {
  for (const roomType of ROOM_TYPES) {
    for (const destination of ROOM_IMAGE_DESTINATIONS) {
      if (!isDestinationValid(images, roomType, destination)) {
        const roomName = ROOM_TYPE_LABELS[roomType];
        const label = destination === "roomsPage" ? "Rooms page" : destination;
        throw new RoomImageValidationError(
          `At least one ${roomName} image must remain selected for the ${label}.`,
        );
      }
    }
  }
}

function createLoadResult(): RoomImageLoadResult {
  const images = createDiscoveredImages();
  const { records, warnings } = readPersistedSettings();
  const unmappedFolders = [
    ...new Set(
      Object.keys(discoveredAssets)
        .map((path) => path.match(/\/rooms\/([^/]+)\//)?.[1])
        .filter((folder): folder is string => folder !== undefined && !isRoomType(folder)),
    ),
  ];
  warnings.push(
    ...unmappedFolders.map(
      (folder) =>
        `Room image folder src/assets/rooms/${folder}/ does not match a supported room type.`,
    ),
  );

  for (const image of images) {
    const saved = records[image.id];
    if (saved && saved.roomType === image.roomType) {
      image.selections = { ...saved.selections };
      image.displayOrder = saved.displayOrder;
    } else if (saved) {
      warnings.push(
        `Saved room assignment for ${image.filename} was invalid; defaults are being used.`,
      );
    }
  }

  for (const roomType of ROOM_TYPES) {
    const roomImages = images.filter((image) => image.roomType === roomType);
    if (roomImages.length === 0) {
      warnings.push(`No room images found in src/assets/rooms/${roomType}/.`);
      continue;
    }
    for (const destination of ROOM_IMAGE_DESTINATIONS) {
      if (!isDestinationValid(images, roomType, destination)) {
        roomImages[0]!.selections[destination] = true;
        warnings.push(
          `Invalid saved selection recovered: at least one ${ROOM_TYPE_LABELS[roomType]} image is selected for ${destination === "roomsPage" ? "the Rooms page" : destination}.`,
        );
      }
    }
  }

  return { images, warnings };
}

async function mergeServerRoomImages(result: RoomImageLoadResult) {
  if (typeof window === "undefined") return result;
  try {
    const responses = await Promise.all(
      ROOM_TYPES.map((roomType) => apiFetch(`/images/room?type=${roomType}`)),
    );
    const payloads = await Promise.all(
      responses.map((response) =>
        response.ok
          ? (response.json() as Promise<{
              images?: Array<{
                id: string;
                category: string;
                url: string;
                path: string | null;
                sourceType: "bundled" | "upload" | "external";
                filename: string | null;
              }>;
              disabledBundledIds?: string[];
            }>)
          : null,
      ),
    );
    const bundledIds = new Set(createDiscoveredImages().map((image) => image.id));
    const disabledBundledIds = new Set(
      payloads.flatMap((payload) => payload?.disabledBundledIds ?? []),
    );
    result.images = result.images.filter(
      (image) => !bundledIds.has(image.id) || !disabledBundledIds.has(image.id),
    );
    for (const image of payloads.flatMap((payload) => payload?.images ?? [])) {
      if (result.images.some((current) => current.id === image.id)) continue;
      result.images.push({
        id: image.id,
        roomType: image.category as RoomType,
        filename: image.filename ?? image.id,
        storageKey: image.path ?? image.url,
        url: apiResourceUrl(image.url),
        altText: `${ROOM_TYPE_LABELS[image.category as RoomType]} room at Hotel PNS Nakshatra`,
        displayOrder: 0,
        active: true,
        selections: { ...DEFAULT_SELECTIONS },
      });
    }
    result.images.sort((left, right) => left.storageKey.localeCompare(right.storageKey));
  } catch {
    result.warnings.push(
      "Managed room images could not be refreshed; bundled images are being used.",
    );
  }
  return result;
}

function serializeSettings(images: RoomImage[]): PersistedSettings {
  return {
    version: SCHEMA_VERSION,
    images: Object.fromEntries(
      images.map((image) => [
        image.id,
        {
          roomType: image.roomType,
          selections: image.selections,
          displayOrder: image.displayOrder,
        },
      ]),
    ),
  };
}

export class LocalRoomImageRepository implements RoomImageRepository {
  private readonly listeners = new Set<() => void>();

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("storage", (event) => {
        if (event.key === STORAGE_KEY) this.notify();
      });
    }
  }

  async listImages(): Promise<RoomImageLoadResult> {
    return mergeServerRoomImages(createLoadResult());
  }

  async updateSelection(
    imageId: string,
    destination: RoomImageDestination,
    selected: boolean,
  ): Promise<RoomImageLoadResult> {
    const result = createLoadResult();
    const image = result.images.find((candidate) => candidate.id === imageId);
    if (!image) {
      throw new RoomImageRepositoryError(`Room image ${imageId} is not available.`);
    }
    if (image.selections[destination] === selected) return result;

    image.selections[destination] = selected;
    validateMinimumSelections(result.images);

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeSettings(result.images)));
    } catch {
      throw new RoomImageRepositoryError(
        "Room-image selections could not be saved in this browser.",
      );
    }

    this.notify();
    return { images: result.images, warnings: result.warnings };
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

export const roomImageRepository: RoomImageRepository = new LocalRoomImageRepository();

const DINING_STORAGE_KEY = "pns-dining-images:v1";
const DEFAULT_DINING_SELECTIONS: DiningImageSelections = {
  homepage: true,
  diningPage: true,
  diningHero: true,
  aboutPage: true,
  gallery: true,
};
const DEFAULT_DINING_COUNTS: DiningDisplayCounts = { diningPage: 1, diningHero: 1 };
const discoveredDiningAssets = diningImageAssets;
const unavailableDiningImageIds = new Set<string>();

type DiningSettingsRecord = {
  diningType: DiningType;
  selections: DiningImageSelections;
  displayOrder: number;
};

type PersistedDiningSettings = {
  version: 1;
  images: Record<string, DiningSettingsRecord>;
  displayCounts: Record<DiningType, DiningDisplayCounts>;
};

function isDiningType(value: unknown): value is DiningType {
  return typeof value === "string" && DINING_TYPES.includes(value as DiningType);
}

function diningTypeForAssetPath(path: string): DiningType | null {
  const match = path.match(/\/dining\/([^/]+)\//);
  return match && isDiningType(match[1]) ? match[1] : null;
}

function isDiningSelection(value: unknown): value is DiningImageSelections {
  if (!value || typeof value !== "object") return false;
  const selections = value as Record<string, unknown>;
  return DINING_IMAGE_DESTINATIONS.every(
    (destination) => typeof selections[destination] === "boolean",
  );
}

function diningDestinationLabel(destination: DiningImageDestination) {
  switch (destination) {
    case "diningPage":
      return "the Dining page";
    case "diningHero":
      return "the Dining hero";
    case "aboutPage":
      return "the About page";
    case "homepage":
      return "the homepage";
    case "gallery":
      return "the gallery";
  }
}

function createDiscoveredDiningImages(): DiningImage[] {
  const images = Object.entries(discoveredDiningAssets)
    .map<DiningImage | null>(([path, url]) => {
      const diningType = diningTypeForAssetPath(path);
      if (!diningType) return null;
      const filename = path.split("/").pop() ?? path;
      const storageKey = path.replace(/^\/src\/assets\/dining\//, "");
      return {
        id: `${diningType}:${storageKey.toLowerCase()}`,
        diningType,
        filename,
        storageKey,
        url,
        altText: `${DINING_TYPE_LABELS[diningType]} at Hotel PNS Nakshatra`,
        displayOrder: 0,
        active: !unavailableDiningImageIds.has(`${diningType}:${storageKey.toLowerCase()}`),
        selections: { ...DEFAULT_DINING_SELECTIONS },
      };
    })
    .filter((image): image is DiningImage => image !== null)
    .sort((left, right) => left.storageKey.localeCompare(right.storageKey));
  const ids = new Set<string>();
  for (const image of images) {
    if (ids.has(image.id)) {
      throw new RoomImageRepositoryError(`Duplicate dining image ID discovered: ${image.id}`);
    }
    ids.add(image.id);
  }
  return images;
}

function createDefaultDiningCounts(): Record<DiningType, DiningDisplayCounts> {
  return Object.fromEntries(
    DINING_TYPES.map((type) => [type, { ...DEFAULT_DINING_COUNTS }]),
  ) as Record<DiningType, DiningDisplayCounts>;
}

function readPersistedDiningSettings() {
  const warnings: string[] = [];
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(DINING_STORAGE_KEY);
  } catch {
    return {
      records: {} as Record<string, DiningSettingsRecord>,
      displayCounts: createDefaultDiningCounts(),
      warnings: ["Browser storage is unavailable; default dining-image selections are being used."],
    };
  }
  if (!stored)
    return {
      records: {} as Record<string, DiningSettingsRecord>,
      displayCounts: createDefaultDiningCounts(),
      warnings,
    };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return {
      records: {} as Record<string, DiningSettingsRecord>,
      displayCounts: createDefaultDiningCounts(),
      warnings: ["Saved dining-image settings were invalid and have been reset to defaults."],
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return {
      records: {} as Record<string, DiningSettingsRecord>,
      displayCounts: createDefaultDiningCounts(),
      warnings: ["Saved dining-image settings were invalid and have been reset to defaults."],
    };
  }
  const saved = parsed as Partial<PersistedDiningSettings>;
  if (saved.version !== 1 || !saved.images || typeof saved.images !== "object") {
    return {
      records: {} as Record<string, DiningSettingsRecord>,
      displayCounts: createDefaultDiningCounts(),
      warnings: [
        "Saved dining-image settings used an unsupported format and have been reset to defaults.",
      ],
    };
  }
  const records: Record<string, DiningSettingsRecord> = {};
  for (const [id, value] of Object.entries(saved.images)) {
    if (
      !value ||
      typeof value !== "object" ||
      !isDiningType(value.diningType) ||
      !isDiningSelection(value.selections) ||
      !Number.isInteger(value.displayOrder) ||
      value.displayOrder < 0
    ) {
      warnings.push(`Saved settings for dining image ${id} were invalid; defaults are being used.`);
      continue;
    }
    records[id] = value;
  }
  const displayCounts = createDefaultDiningCounts();
  if (saved.displayCounts && typeof saved.displayCounts === "object") {
    for (const type of DINING_TYPES) {
      const counts = saved.displayCounts[type];
      if (
        !counts ||
        ![1, 2, 3].includes(counts.diningPage) ||
        ![1, 2, 3].includes(counts.diningHero)
      ) {
        warnings.push(
          `Saved display counts for ${DINING_TYPE_LABELS[type]} were invalid; defaults are being used.`,
        );
        continue;
      }
      displayCounts[type] = { diningPage: counts.diningPage, diningHero: counts.diningHero };
    }
  }
  return { records, displayCounts, warnings };
}

function createDiningLoadResult(): DiningImageLoadResult {
  const images = createDiscoveredDiningImages();
  const saved = readPersistedDiningSettings();
  const counts = saved.displayCounts;
  const folderNames = [
    ...new Set(
      Object.keys(discoveredDiningAssets)
        .map((path) => path.match(/\/dining\/([^/]+)\//)?.[1])
        .filter((name): name is string => name !== undefined),
    ),
  ];
  saved.warnings.push(
    ...folderNames
      .filter((name) => !isDiningType(name))
      .map(
        (name) =>
          `Dining image folder src/assets/dining/${name}/ does not match a supported category.`,
      ),
  );
  for (const image of images) {
    const record = saved.records[image.id];
    if (record?.diningType === image.diningType) {
      image.selections = { ...record.selections };
      image.displayOrder = record.displayOrder;
    }
  }
  for (const type of DINING_TYPES) {
    const categoryImages = images.filter((image) => image.diningType === type);
    const activeImages = categoryImages.filter((image) => image.active);
    if (!activeImages.length) {
      saved.warnings.push(
        categoryImages.length
          ? `No available dining images found in src/assets/dining/${type}/.`
          : `No dining images found in src/assets/dining/${type}/.`,
      );
      continue;
    }
    for (const destination of DINING_IMAGE_DESTINATIONS) {
      if (!activeImages.some((image) => image.selections[destination])) {
        activeImages[0]!.selections[destination] = true;
        saved.warnings.push(
          `Invalid saved selection recovered: at least one ${DINING_TYPE_LABELS[type]} image is selected for ${destination}.`,
        );
      }
    }
    const availablePage = activeImages.filter((image) => image.selections.diningPage).length;
    const availableHero = activeImages.filter((image) => image.selections.diningHero).length;
    if (counts[type].diningPage > availablePage) {
      counts[type].diningPage = Math.max(1, Math.min(3, availablePage)) as 1 | 2 | 3;
      saved.warnings.push(
        `Dining page image count for ${DINING_TYPE_LABELS[type]} was reduced to fit its selected images.`,
      );
    }
    if (counts[type].diningHero > availableHero) {
      counts[type].diningHero = Math.max(1, Math.min(3, availableHero)) as 1 | 2 | 3;
      saved.warnings.push(
        `Dining hero image count for ${DINING_TYPE_LABELS[type]} was reduced to fit its selected images.`,
      );
    }
  }
  return { images, warnings: saved.warnings, displayCounts: counts };
}

async function mergeServerDiningImages(result: DiningImageLoadResult) {
  if (typeof window === "undefined") return result;
  try {
    const responses = await Promise.all(
      DINING_TYPES.map((diningType) => apiFetch(`/images/dining?type=${diningType}`)),
    );
    const payloads = await Promise.all(
      responses.map((response) =>
        response.ok
          ? (response.json() as Promise<{
              images?: Array<{
                id: string;
                category: string;
                url: string;
                path: string | null;
                sourceType: "bundled" | "upload" | "external";
                filename: string | null;
              }>;
              disabledBundledIds?: string[];
            }>)
          : null,
      ),
    );
    const bundledIds = new Set(createDiscoveredDiningImages().map((image) => image.id));
    const disabledBundledIds = new Set(
      payloads.flatMap((payload) => payload?.disabledBundledIds ?? []),
    );
    result.images = result.images.filter(
      (image) => !bundledIds.has(image.id) || !disabledBundledIds.has(image.id),
    );
    for (const image of payloads.flatMap((payload) => payload?.images ?? [])) {
      if (result.images.some((current) => current.id === image.id)) continue;
      const diningType = image.category as DiningType;
      result.images.push({
        id: image.id,
        diningType,
        filename: image.filename ?? image.id,
        storageKey: image.path ?? image.url,
        url: apiResourceUrl(image.url),
        altText: `${DINING_TYPE_LABELS[diningType]} at Hotel PNS Nakshatra`,
        displayOrder: 0,
        active: true,
        selections: { ...DEFAULT_DINING_SELECTIONS },
      });
    }
    result.images.sort((left, right) => left.storageKey.localeCompare(right.storageKey));
  } catch {
    result.warnings.push(
      "Managed dining images could not be refreshed; bundled images are being used.",
    );
  }
  return result;
}

function serializeDiningSettings(result: DiningImageLoadResult): PersistedDiningSettings {
  return {
    version: 1,
    images: Object.fromEntries(
      result.images.map((image) => [
        image.id,
        {
          diningType: image.diningType,
          selections: image.selections,
          displayOrder: image.displayOrder,
        },
      ]),
    ),
    displayCounts: result.displayCounts,
  };
}

export class LocalDiningImageRepository implements DiningImageRepository {
  private readonly listeners = new Set<() => void>();

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("storage", (event) => {
        if (event.key === DINING_STORAGE_KEY) this.notify();
      });
    }
  }

  async listImages() {
    return mergeServerDiningImages(createDiningLoadResult());
  }

  async updateSelection(imageId: string, destination: DiningImageDestination, selected: boolean) {
    const result = createDiningLoadResult();
    const image = result.images.find((candidate) => candidate.id === imageId);
    if (!image) throw new RoomImageRepositoryError(`Dining image ${imageId} is not available.`);
    if (!image.active) {
      throw new RoomImageRepositoryError(`Dining image ${image.filename} is unavailable.`);
    }
    if (image.selections[destination] === selected) return result;
    image.selections[destination] = selected;
    const categoryImages = result.images.filter(
      (candidate) => candidate.diningType === image.diningType && candidate.active,
    );
    if (!categoryImages.some((candidate) => candidate.selections[destination])) {
      throw new DiningImageValidationError(
        `At least one ${DINING_TYPE_LABELS[image.diningType]} image must remain selected for ${diningDestinationLabel(destination)}.`,
      );
    }
    for (const destinationWithCount of ["diningPage", "diningHero"] as const) {
      const selectedCount = categoryImages.filter(
        (candidate) => candidate.selections[destinationWithCount],
      ).length;
      if (selectedCount < result.displayCounts[image.diningType][destinationWithCount]) {
        throw new DiningImageValidationError(
          `Select at least ${result.displayCounts[image.diningType][destinationWithCount]} ${DINING_TYPE_LABELS[image.diningType]} images for the ${destinationWithCount === "diningPage" ? "Dining page" : "Dining hero"} before removing this image.`,
        );
      }
    }
    this.save(result);
    this.notify();
    return result;
  }

  async updateDisplayCount(
    diningType: DiningType,
    destination: DiningDisplayDestination,
    count: 1 | 2 | 3,
  ) {
    if (count !== 1 && count !== 2 && count !== 3) {
      throw new DiningImageValidationError("Dining display count must be 1, 2, or 3 images.");
    }
    const result = createDiningLoadResult();
    const eligible = result.images.filter(
      (image) => image.diningType === diningType && image.active && image.selections[destination],
    ).length;
    if (eligible < count) {
      throw new DiningImageValidationError(
        `Select at least ${count} ${DINING_TYPE_LABELS[diningType]} images for the ${destination === "diningPage" ? "Dining page" : "Dining hero"} before saving this display count.`,
      );
    }
    result.displayCounts[diningType][destination] = count;
    this.save(result);
    this.notify();
    return result;
  }

  async updateDisplayOrder(imageId: string, displayOrder: number) {
    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      throw new DiningImageValidationError("Display order must be a non-negative whole number.");
    }
    const result = createDiningLoadResult();
    const image = result.images.find((candidate) => candidate.id === imageId);
    if (!image) throw new RoomImageRepositoryError(`Dining image ${imageId} is not available.`);
    if (!image.active) {
      throw new RoomImageRepositoryError(`Dining image ${image.filename} is unavailable.`);
    }
    image.displayOrder = displayOrder;
    this.save(result);
    this.notify();
    return result;
  }

  reportUnavailable(imageId: string) {
    if (unavailableDiningImageIds.has(imageId)) return;
    unavailableDiningImageIds.add(imageId);
    this.notify();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private save(result: DiningImageLoadResult) {
    try {
      window.localStorage.setItem(
        DINING_STORAGE_KEY,
        JSON.stringify(serializeDiningSettings(result)),
      );
    } catch {
      throw new RoomImageRepositoryError(
        "Dining-image settings could not be saved in this browser.",
      );
    }
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

export const diningImageRepository: DiningImageRepository = new LocalDiningImageRepository();

export function getSelectedDiningImages(
  images: DiningImage[],
  destination: DiningImageDestination,
  diningType?: DiningType,
) {
  return images
    .filter(
      (image) =>
        image.active &&
        image.selections[destination] &&
        (diningType === undefined || image.diningType === diningType),
    )
    .sort(
      (left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id),
    );
}

export function getDiningImageCounts(images: DiningImage[], diningType: DiningType) {
  return Object.fromEntries(
    DINING_IMAGE_DESTINATIONS.map((destination) => [
      destination,
      images.filter(
        (image) => image.diningType === diningType && image.active && image.selections[destination],
      ).length,
    ]),
  ) as Record<DiningImageDestination, number>;
}

export function getSelectedRoomImages(
  images: RoomImage[],
  destination: RoomImageDestination,
  roomType?: RoomType,
) {
  return images
    .filter(
      (image) =>
        image.active &&
        image.selections[destination] &&
        (roomType === undefined || image.roomType === roomType),
    )
    .sort(
      (left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id),
    );
}

export function getRoomImageCounts(images: RoomImage[], roomType: RoomType) {
  return Object.fromEntries(
    ROOM_IMAGE_DESTINATIONS.map((destination) => [
      destination,
      images.filter(
        (image) => image.roomType === roomType && image.active && image.selections[destination],
      ).length,
    ]),
  ) as Record<RoomImageDestination, number>;
}

export function getBundledImageRecords(
  collection: "room" | "dining",
  category: string,
): BundledManagedImage[] {
  const assets = collection === "room" ? roomImageAssets : diningImageAssets;
  const pathSegment = collection === "room" ? "rooms" : "dining";
  return Object.entries(assets).flatMap(([assetPath, url]) => {
    const match = assetPath.match(new RegExp(`/src/assets/${pathSegment}/([^/]+)/`));
    if (!match || match[1] !== category) return [];
    const storageKey = assetPath.replace(new RegExp(`^/src/assets/${pathSegment}/`), "");
    const filename = assetPath.split("/").pop() ?? assetPath;
    return [
      {
        id: `${category}:${storageKey.toLowerCase()}`,
        category,
        url,
        path: assetPath.replace(/^\//u, ""),
        sourceType: "bundled" as const,
        filename,
        displayLocation: "gallery",
        displayOrder: 0,
        active: true,
      },
    ];
  });
}
