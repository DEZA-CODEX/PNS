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
  type RoomType,
} from "@/types/roomImages";
import { apiFetch, apiResourceUrl } from "@/lib/api-client";

type HomepageImagePayload = {
  images?: Partial<
    Record<
      "room" | "dining" | "hero",
      Record<
        string,
        Array<{
          id: string;
          category: string;
          url: string;
          path: string | null;
          sourceType: "bundled" | "upload" | "external";
          filename: string | null;
          displayOrder?: number;
          active?: boolean;
          selections?: Record<string, boolean>;
        }>
      >
    >
  >;
  disabledBundledIds?: Partial<Record<"room" | "dining" | "hero", Record<string, string[]>>>;
};

let homepageCache: HomepageImagePayload | null = null;
let homepageCacheAt = 0;
let homepageRequest: Promise<HomepageImagePayload> | null = null;

async function getImagePayload(endpoint: string, collection: "room" | "dining") {
  if (endpoint === "/images/homepage") {
    if (homepageCache && Date.now() - homepageCacheAt < 15_000) return homepageCache;
    if (homepageRequest) return homepageRequest;
  }

  const request = apiFetch(endpoint).then(async (response) => {
    if (!response.ok) {
      throw new RoomImageRepositoryError(`${collection} images could not be loaded.`);
    }
    const payload = (await response.json()) as HomepageImagePayload;
    const images = payload.images ?? {};
    const disabledBundledIds = payload.disabledBundledIds ?? {};
    if (!(collection in images)) {
      payload.images = {
        [collection]: images,
      } as NonNullable<HomepageImagePayload["images"]>;
      payload.disabledBundledIds = {
        [collection]: disabledBundledIds,
      } as NonNullable<HomepageImagePayload["disabledBundledIds"]>;
    }
    return payload;
  });

  if (endpoint !== "/images/homepage") return request;
  homepageRequest = request
    .then((payload) => {
      homepageCache = payload;
      homepageCacheAt = Date.now();
      return payload;
    })
    .finally(() => {
      homepageRequest = null;
    });
  return homepageRequest;
}

async function patchManagedImage(
  imageId: string,
  categoryType: "room" | "dining",
  patch: Record<string, unknown>,
) {
  const response = await apiFetch(`/admin/images/${encodeURIComponent(imageId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ categoryType, ...patch }),
  });
  const body = (await response.json()) as { error?: { message?: string } };
  if (!response.ok) {
    throw new RoomImageRepositoryError(
      body.error?.message ?? "Image settings could not be saved to the database.",
    );
  }
}

async function getHomepageImages(): Promise<HomepageImagePayload> {
  return getImagePayload("/images/homepage", "room");
}

export function refreshHomepageImages() {
  homepageCache = null;
  homepageCacheAt = 0;
  return getHomepageImages();
}

export function refreshSectionImages(collection: "room" | "dining") {
  return getImagePayload(`/images/${collection === "room" ? "rooms" : "dining"}`, collection);
}

function createLoadResult(): RoomImageLoadResult {
  return { images: [], warnings: [] };
}

async function mergeServerRoomImages(result: RoomImageLoadResult, endpoint = "/images/homepage") {
  if (typeof window === "undefined") return result;
  try {
    const payload = await getImagePayload(endpoint, "room");
    result.images = Object.entries(payload.images?.room ?? {}).flatMap(([category, records]) =>
      records.map((image) => ({
        id: image.id,
        roomType: category as RoomType,
        filename: image.filename ?? image.id,
        storageKey: image.path ?? image.url,
        url: apiResourceUrl(image.url),
        altText: `${ROOM_TYPE_LABELS[category as RoomType]} room at Hotel PNS Nakshatra`,
        displayOrder: image.displayOrder ?? 0,
        active: image.active ?? true,
        selections: {
          homepage: image.selections?.["homepage"] === true,
          roomsPage: image.selections?.["roomsPage"] === true,
          gallery: image.selections?.["gallery"] === true,
        },
      })),
    );
    result.images.sort((left, right) => left.storageKey.localeCompare(right.storageKey));
  } catch {
    result.warnings.push(
      "Room image mappings could not be loaded from the database.",
    );
  }
  return result;
}

export class LocalRoomImageRepository implements RoomImageRepository {
  private readonly listeners = new Set<() => void>();

  async listImages(endpoint = "/images/homepage"): Promise<RoomImageLoadResult> {
    return mergeServerRoomImages(createLoadResult(), endpoint);
  }

  async updateSelection(
    imageId: string,
    destination: RoomImageDestination,
    selected: boolean,
  ): Promise<RoomImageLoadResult> {
    const result = await this.listImages("/images/rooms");
    const image = result.images.find((candidate) => candidate.id === imageId);
    if (!image) {
      throw new RoomImageRepositoryError(`Room image ${imageId} is not available.`);
    }
    if (image.selections[destination] === selected) return result;

    const selectedCount = result.images.filter(
      (candidate) =>
        candidate.roomType === image.roomType &&
        candidate.active &&
        candidate.selections[destination],
    ).length;
    if (!selected && selectedCount <= 1) {
      throw new RoomImageValidationError(
        `At least one ${ROOM_TYPE_LABELS[image.roomType]} image must remain selected for ${destination === "roomsPage" ? "the Rooms page" : destination}.`,
      );
    }
    await patchManagedImage(imageId, "room", { selections: { [destination]: selected } });
    await refreshHomepageImages();
    this.notify();
    return this.listImages("/images/rooms");
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
const DEFAULT_DINING_COUNTS: DiningDisplayCounts = { diningPage: 1, diningHero: 1 };
const unavailableDiningImageIds = new Set<string>();

type PersistedDiningSettings = {
  version: 1;
  displayCounts: Record<DiningType, DiningDisplayCounts>;
};

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
      displayCounts: createDefaultDiningCounts(),
      warnings: ["Browser storage is unavailable; default dining display counts are being used."],
    };
  }
  if (!stored) return { displayCounts: createDefaultDiningCounts(), warnings };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return {
      displayCounts: createDefaultDiningCounts(),
      warnings: ["Saved dining display counts were invalid and have been reset to defaults."],
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return {
      displayCounts: createDefaultDiningCounts(),
      warnings: ["Saved dining display counts were invalid and have been reset to defaults."],
    };
  }
  const saved = parsed as Partial<PersistedDiningSettings>;
  if (saved.version !== 1) {
    return {
      displayCounts: createDefaultDiningCounts(),
      warnings: ["Saved dining display counts used an unsupported format and were reset."],
    };
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
  return { displayCounts, warnings };
}

function createDiningLoadResult(): DiningImageLoadResult {
  const saved = readPersistedDiningSettings();
  return { images: [], warnings: saved.warnings, displayCounts: saved.displayCounts };
}

async function mergeServerDiningImages(
  result: DiningImageLoadResult,
  endpoint = "/images/homepage",
) {
  if (typeof window === "undefined") return result;
  try {
    const payload = await getImagePayload(endpoint, "dining");
    result.images = Object.entries(payload.images?.dining ?? {}).flatMap(([category, records]) =>
      records.map((image) => {
        const diningType = category as DiningType;
        return {
          id: image.id,
          diningType,
          filename: image.filename ?? image.id,
          storageKey: image.path ?? image.url,
          url: apiResourceUrl(image.url),
          altText: `${DINING_TYPE_LABELS[diningType]} at Hotel PNS Nakshatra`,
          displayOrder: image.displayOrder ?? 0,
          active: (image.active ?? true) && !unavailableDiningImageIds.has(image.id),
          selections: {
            homepage: image.selections?.["homepage"] === true,
            diningPage: image.selections?.["diningPage"] === true,
            diningHero: image.selections?.["diningHero"] === true,
            aboutPage: image.selections?.["aboutPage"] === true,
            gallery: image.selections?.["gallery"] === true,
          },
        };
      }),
    );
    const { displayCounts } = readPersistedDiningSettings();
    for (const diningType of DINING_TYPES) {
      const activeImages = result.images.filter(
        (image) => image.diningType === diningType && image.active,
      );
      for (const destination of ["diningPage", "diningHero"] as const) {
        const selectedCount = activeImages.filter((image) => image.selections[destination]).length;
        if (displayCounts[diningType][destination] > selectedCount && selectedCount > 0) {
          displayCounts[diningType][destination] = Math.min(selectedCount, 3) as 1 | 2 | 3;
          result.warnings.push(
            `Dining ${destination === "diningPage" ? "page" : "hero"} image count for ${DINING_TYPE_LABELS[diningType]} was reduced to fit its selected images.`,
          );
        }
      }
    }
    result.displayCounts = displayCounts;
    result.images.sort((left, right) => left.storageKey.localeCompare(right.storageKey));
  } catch {
    result.warnings.push(
      "Dining image mappings could not be loaded from the database.",
    );
  }
  return result;
}

function serializeDiningSettings(result: DiningImageLoadResult): PersistedDiningSettings {
  return {
    version: 1,
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

  async listImages(endpoint = "/images/homepage") {
    return mergeServerDiningImages(createDiningLoadResult(), endpoint);
  }

  async listAboutImages() {
    return mergeServerDiningImages(createDiningLoadResult(), "/images/about");
  }

  async updateSelection(imageId: string, destination: DiningImageDestination, selected: boolean) {
    const result = await this.listImages("/images/dining");
    const image = result.images.find((candidate) => candidate.id === imageId);
    if (!image) throw new RoomImageRepositoryError(`Dining image ${imageId} is not available.`);
    if (!image.active) {
      throw new RoomImageRepositoryError(`Dining image ${image.filename} is unavailable.`);
    }
    if (image.selections[destination] === selected) return result;
    const categoryImages = result.images.filter(
      (candidate) => candidate.diningType === image.diningType && candidate.active,
    );
    const selectedCount = categoryImages.filter(
      (candidate) => candidate.selections[destination],
    ).length;
    if (!selected && selectedCount <= 1) {
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
    await patchManagedImage(imageId, "dining", { selections: { [destination]: selected } });
    await refreshHomepageImages();
    this.notify();
    return this.listImages("/images/dining");
  }

  async updateDisplayCount(
    diningType: DiningType,
    destination: DiningDisplayDestination,
    count: 1 | 2 | 3,
  ) {
    if (count !== 1 && count !== 2 && count !== 3) {
      throw new DiningImageValidationError("Dining display count must be 1, 2, or 3 images.");
    }
    const result = await this.listImages("/images/dining");
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
    const result = await this.listImages("/images/dining");
    const image = result.images.find((candidate) => candidate.id === imageId);
    if (!image) throw new RoomImageRepositoryError(`Dining image ${imageId} is not available.`);
    if (!image.active) {
      throw new RoomImageRepositoryError(`Dining image ${image.filename} is unavailable.`);
    }
    await patchManagedImage(imageId, "dining", { displayOrder });
    this.notify();
    return this.listImages("/images/dining");
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

