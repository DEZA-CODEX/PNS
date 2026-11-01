import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { diningImageAssets, roomImageAssets } from "@/lib/asset-manifest";
import { processUploadedImageFile, processUploadedImagesBatch, maxUploadBytes } from "@/lib/image-processing";
import { DINING_TYPES, ROOM_TYPES, type DiningType, type RoomType } from "@/types/roomImages";
import {
  disableBundledImage,
  disableDatabaseImage,
  listDatabaseImages,
  saveDatabaseImage,
  usesDatabaseImageStore,
} from "@/lib/image-database";

export type ImageCollection = "room" | "dining";
export type ImageSourceType = "bundled" | "upload" | "external";

export type ManagedImage = {
  id: string;
  category: string;
  url: string;
  path: string | null;
  sourceType: ImageSourceType;
  filename: string | null;
  displayLocation?: string;
  displayOrder?: number;
  active?: boolean;
};

type StoredImage = ManagedImage & { deleted?: boolean };
type ImageManifest = { version: number; images: StoredImage[] };

const manifestPath = path.resolve(
  process.env["PNS_IMAGE_MANIFEST"] ?? "data/uploads/image-manifest.json",
);
const defaultStorageRoot = path.resolve(process.env["PNS_IMAGE_STORAGE_DIR"] ?? "public/uploads");
const categorySets: Record<ImageCollection, readonly string[]> = {
  room: ROOM_TYPES,
  dining: DINING_TYPES,
};

function assertCategory(collection: ImageCollection, category: string) {
  if (!categorySets[collection].includes(category)) {
    throw new ImageManagementError(
      "invalid_category",
      "The selected image category is invalid.",
      400,
    );
  }
}

function assetsFor(collection: ImageCollection) {
  return collection === "room" ? roomImageAssets : diningImageAssets;
}

function categoryFromAsset(collection: ImageCollection, assetPath: string) {
  const marker = collection === "room" ? "/rooms/" : "/dining/";
  const match = assetPath.match(new RegExp(`${marker}([^/]+)/`));
  return match?.[1] ?? null;
}

export function staticImages(collection: ImageCollection): ManagedImage[] {
  return Object.entries(assetsFor(collection)).flatMap(([assetPath, url]) => {
    const category = categoryFromAsset(collection, assetPath);
    if (!category || !categorySets[collection].includes(category)) return [];
    const filename = assetPath.split("/").pop() ?? assetPath;
    return [
      {
        id: `${category}:${`${category}/${filename}`.toLowerCase()}`,
        category,
        url,
        path: assetPath.replace(/^\//, ""),
        sourceType: "bundled" as const,
        filename,
        displayLocation: "gallery",
        displayOrder: 0,
        active: true,
      },
    ];
  });
}

async function readManifest(): Promise<ImageManifest> {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<ImageManifest>;
    if (!Array.isArray(parsed.images)) return { version: 1, images: [] };
    return { version: 1, images: parsed.images };
  } catch {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify({ version: 1, images: [] }, null, 2)}\n`, "utf8");
    return { version: 1, images: [] };
  }
}

async function writeManifest(manifest: ImageManifest) {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function syncManifestBackup(image: StoredImage & { active?: boolean; displayOrder?: number }) {
  const customManifestPath = process.env["PNS_IMAGE_MANIFEST"];
  if (!customManifestPath) return;
  const file = path.resolve(customManifestPath);
  const existing = await readManifest();
  const sanitized: StoredImage = {
    id: image.id,
    category: image.category,
    url: image.url,
    path: image.path,
    sourceType: image.sourceType,
    filename: image.filename,
    displayLocation: image.displayLocation ?? "gallery",
    displayOrder: image.displayOrder ?? 0,
    active: image.active ?? true,
    deleted: false,
  };
  const manifest = existing;
  const index = manifest.images.findIndex((candidate) => candidate.id === sanitized.id);
  if (index >= 0) {
    manifest.images[index] = { ...manifest.images[index], ...sanitized };
  } else {
    manifest.images.push(sanitized);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function visibleImages(collection: ImageCollection, category: string, manifest: ImageManifest) {
  const deleted = new Set(
    manifest.images.filter((image) => image.deleted).map((image) => image.id),
  );
  const bundled = staticImages(collection).filter(
    (image) => image.category === category && !deleted.has(image.id),
  );
  const managed = manifest.images.filter(
    (image) =>
      !image.deleted && image.category === category && image.id.startsWith(`${collection}:`),
  );
  return [...bundled, ...managed];
}

async function hasStoredUploadImage(relativePath: string | null) {
  if (!relativePath) return false;
  const normalized = relativePath.replace(/^\/+/u, "").replace(/^uploads\//u, "");
  const target = path.resolve(defaultStorageRoot, normalized);
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function listManagedImages(
  collection: ImageCollection,
  category: string,
  displayLocation?: string,
) {
  assertCategory(collection, category);
  if (usesDatabaseImageStore()) {
    const databaseImages = await listDatabaseImages(collection, category, displayLocation);
    const deletedBundledIds = new Set(
      databaseImages
        .filter((image) => image.sourceType === "bundled" && !image.active)
        .map((image) => image.id),
    );
    const bundled = staticImages(collection)
      .filter((image) => image.category === category)
      .filter((image) => !deletedBundledIds.has(image.id));
    return [...bundled, ...databaseImages.filter((image) => image.active && image.category === category)];
  }
  const manifest = await readManifest();
  return visibleImages(collection, category, manifest);
}

export async function listPublicImages(
  collection: ImageCollection,
  category: string,
  displayLocation?: string,
) {
  return listManagedImages(collection, category, displayLocation);
}

export async function addExternalImage(
  collection: ImageCollection,
  category: string,
  imageUrl: string,
  createdBy: string | null = null,
) {
  assertCategory(collection, category);
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new ImageManagementError("invalid_url", "Enter a valid image URL.", 400);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ImageManagementError(
      "invalid_url_scheme",
      "Only HTTP and HTTPS image URLs are allowed.",
      400,
    );
  }
  if (usesDatabaseImageStore()) {
    const saved = await saveDatabaseImage({
      collection,
      category,
      url: parsed.toString(),
      path: null,
      sourceType: "external",
      createdBy,
    });
    await syncManifestBackup({
      ...saved,
      id: saved.id,
      sourceType: "external",
      category,
      filename: saved.filename ?? null,
      displayLocation: saved.displayLocation ?? "gallery",
      displayOrder: saved.displayOrder ?? 0,
      active: saved.active ?? true,
      deleted: false,
    });
    return saved;
  }
  const image: StoredImage = {
    id: `${collection}:external:${randomUUID()}`,
    category,
    url: parsed.toString(),
    path: null,
    sourceType: "external",
    filename: null,
  };
  const manifest = await readManifest();
  manifest.images.push(image);
  await writeManifest(manifest);
  return image;
}

export async function addUploadedImage(
  collection: ImageCollection,
  category: string,
  file: File,
  createdBy: string | null = null,
) {
  assertCategory(collection, category);

  try {
    const converted = await processUploadedImageFile({
      collection,
      category,
      file,
      storageRoot: defaultStorageRoot,
    });

    const image: StoredImage = {
      id: `${collection}:upload:${randomUUID()}`,
      category,
      url: converted.url,
      path: converted.path,
      sourceType: "upload",
      filename: converted.storedName,
    };

    if (usesDatabaseImageStore()) {
      try {
        const saved = await saveDatabaseImage({ ...image, collection, category, createdBy });
        await syncManifestBackup({
          ...saved,
          sourceType: "upload",
          category,
          filename: saved.filename ?? image.filename ?? converted.storedName,
          displayLocation: saved.displayLocation ?? "gallery",
          displayOrder: saved.displayOrder ?? 0,
          active: saved.active ?? true,
          deleted: false,
        });
        return saved;
      } catch (error) {
        await unlink(path.resolve(defaultStorageRoot, converted.path.replace(/^uploads\//u, ""))).catch(
          () => undefined,
        );
        throw error;
      }
    }

    const manifest = await readManifest();
    manifest.images.push(image);
    try {
      await writeManifest(manifest);
    } catch (error) {
      await unlink(path.resolve(defaultStorageRoot, converted.path.replace(/^uploads\//u, ""))).catch(
        () => undefined,
      );
      throw error;
    }
    return image;
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_image";
    if (message === "file_too_large") {
      throw new ImageManagementError("file_too_large", "Images must be 8 MB or smaller.", 400);
    }
    if (message === "animated_image_unsupported") {
      throw new ImageManagementError(
        "animated_image_unsupported",
        "Animated uploads are not supported. Please use a static image file.",
        400,
      );
    }
    if (message === "invalid_storage_path") {
      throw new ImageManagementError(
        "invalid_storage_path",
        "The image storage path is invalid.",
        500,
      );
    }
    if (message === "unsupported_image_format") {
      throw new ImageManagementError(
        "invalid_file_type",
        "Use a JPEG, PNG, WebP, GIF, TIFF, BMP, or AVIF image.",
        400,
      );
    }
    if (message === "image_too_large") {
      throw new ImageManagementError(
        "image_too_large",
        "The uploaded image exceeds the allowed pixel dimensions.",
        400,
      );
    }
    throw new ImageManagementError("invalid_image", "The uploaded image could not be processed.", 400);
  }
}

export async function addUploadedImages(
  collection: ImageCollection,
  category: string,
  files: File[],
  createdBy: string | null = null,
) {
  assertCategory(collection, category);
  const batch = await processUploadedImagesBatch({
    collection,
    category,
    files,
    storageRoot: defaultStorageRoot,
  });

  const fileResults = await Promise.all(
    batch.files.map(async (file) => {
      if (!file.success) {
        return {
          originalName: file.originalName,
          storedName: file.storedName,
          format: file.format || "unknown",
          converted: file.converted,
          success: false,
          path: file.path,
          url: file.url,
          error: file.error,
        };
      }

      const image: StoredImage = {
        id: `${collection}:upload:${randomUUID()}`,
        category,
        url: file.url,
        path: file.path,
        sourceType: "upload",
        filename: file.storedName,
      };

      try {
        if (usesDatabaseImageStore()) {
          const saved = await saveDatabaseImage({ ...image, collection, category, createdBy });
          await syncManifestBackup({
            ...saved,
            sourceType: "upload",
            category,
            filename: saved.filename ?? image.filename ?? file.storedName,
            displayLocation: saved.displayLocation ?? "gallery",
            displayOrder: saved.displayOrder ?? 0,
            active: saved.active ?? true,
            deleted: false,
          });
          return {
            originalName: file.originalName,
            storedName: saved.filename ?? file.storedName,
            format: "webp",
            converted: file.converted,
            success: true,
            path: saved.path ?? file.path,
            url: saved.url ?? file.url,
          };
        }

        const manifest = await readManifest();
        manifest.images.push(image);
        await writeManifest(manifest);
        return {
          originalName: file.originalName,
          storedName: image.filename ?? file.storedName,
          format: "webp",
          converted: file.converted,
          success: true,
          path: image.path ?? file.path,
          url: image.url ?? file.url,
        };
      } catch (error) {
        if (file.path) {
          const destination = path.resolve(defaultStorageRoot, file.path.replace(/^uploads\//u, ""));
          await unlink(destination).catch(() => undefined);
        }
        return {
          originalName: file.originalName,
          storedName: file.storedName,
          format: file.format || "unknown",
          converted: file.converted,
          success: false,
          path: file.path,
          url: file.url,
          error: {
            code: "database_error",
            message: "The image could not be saved to the configured storage backend.",
          },
        };
      }
    }),
  );

  const successful = fileResults.filter((file) => file.success).length;
  const converted = fileResults.filter((file) => file.success && file.converted).length;
  const alreadyWebp = fileResults.filter((file) => file.success && !file.converted).length;
  const failed = fileResults.length - successful;

  return {
    success: failed === 0,
    total: batch.total,
    processed: successful,
    converted,
    alreadyWebp,
    failed,
    files: fileResults,
  };
}

export async function deleteManagedImage(
  collection: ImageCollection,
  category: string,
  id: string,
  createdBy?: string,
) {
  assertCategory(collection, category);
  if (usesDatabaseImageStore()) {
    const disabled = await disableDatabaseImage(collection, category, id);
    if (disabled) {
      if (disabled.source_type === "upload" && disabled.storage_path) {
        const destination = path.resolve(
          defaultStorageRoot,
          disabled.storage_path.replace(/^uploads\//, ""),
        );
        if (!destination.startsWith(`${defaultStorageRoot}${path.sep}`))
          throw new ImageManagementError(
            "invalid_storage_path",
            "The image storage path is invalid.",
            500,
          );
        await unlink(destination).catch(() => undefined);
      }
      return;
    }
    const bundled = staticImages(collection).find(
      (image) => image.id === id && image.category === category,
    );
    if (bundled) {
      await disableBundledImage(collection, category, bundled, createdBy);
      return;
    }
    throw new ImageManagementError("not_found", "The image was not found in this category.", 404);
  }
  const manifest = await readManifest();
  const image = manifest.images.find(
    (candidate) =>
      !candidate.deleted &&
      candidate.id === id &&
      candidate.category === category &&
      candidate.id.startsWith(`${collection}:`),
  );
  if (image) {
    image.deleted = true;
    if (image.sourceType === "upload" && image.path) {
      const destination = path.resolve(defaultStorageRoot, image.path.replace(/^uploads\//, ""));
      if (!destination.startsWith(`${defaultStorageRoot}${path.sep}`)) {
        throw new ImageManagementError(
          "invalid_storage_path",
          "The image storage path is invalid.",
          500,
        );
      }
      await unlink(destination).catch(() => undefined);
    }
    await writeManifest(manifest);
    return;
  }
  const bundled = staticImages(collection).find(
    (candidate) => candidate.id === id && candidate.category === category,
  );
  if (bundled) {
    manifest.images.push({ ...bundled, deleted: true });
    await writeManifest(manifest);
    return;
  }
  throw new ImageManagementError("not_found", "The image was not found in this category.", 404);
}

export class ImageManagementError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ImageManagementError";
  }
}

export function isCollection(value: string): value is ImageCollection {
  return value === "room" || value === "dining";
}

export { maxUploadBytes };
export type { DiningType, RoomType };
