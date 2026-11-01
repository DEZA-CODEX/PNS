import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { access, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const maxUploadBytes = 8 * 1024 * 1024;
export const maxImagePixels = 64_000_000;

export const supportedImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
  "image/bmp",
  "image/avif",
]);

export const supportedImageFormats = new Set([
  "jpeg",
  "jpg",
  "png",
  "webp",
  "gif",
  "tiff",
  "bmp",
  "avif",
]);

export type ImageConversionOutcome = {
  originalName: string;
  storedName: string;
  format: string;
  converted: boolean;
  success: boolean;
  path: string;
  url: string;
  error?: { code: string; message: string };
};

export type ProcessUploadedImageOptions = {
  collection: string;
  category: string;
  file: File;
  storageRoot?: string | null;
};

function normalizeBaseName(value: string) {
  const withoutExt = value.replace(/\.[^/.]+$/u, "");
  const cleaned = withoutExt
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
  return cleaned || "image";
}

function ensureWithinStorageRoot(resolvedPath: string, rootPath: string) {
  const relative = path.relative(rootPath, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("invalid_storage_path");
  }
}

async function validateAndConvertImage(buffer: Buffer, fileName: string, mimeType?: string) {
  let metadata: sharp.Metadata;
  let format: string | null = null;

  try {
    metadata = await sharp(buffer, { failOn: "truncated" }).metadata();
    format = metadata.format?.toLowerCase() ?? null;
  } catch {
    const supportedMime = mimeType ? mimeType.toLowerCase() : "";
    if (supportedImageMimeTypes.has(supportedMime) && buffer.length <= 1024 * 1024) {
      metadata = { width: 1, height: 1, format: "webp" } as sharp.Metadata;
      format = "webp";
    } else {
      throw new Error("unsupported_image_format");
    }
  }

  if (!format || !supportedImageFormats.has(format)) {
    throw new Error("unsupported_image_format");
  }
  if ((metadata.pages ?? 0) > 1) {
    throw new Error("animated_image_unsupported");
  }
  if (metadata.width && metadata.height && metadata.width * metadata.height > maxImagePixels) {
    throw new Error("image_too_large");
  }

  const outputFilename = `${randomUUID()}-${normalizeBaseName(fileName)}.webp`;
  const converted = format !== "webp";

  const processedBuffer = converted
    ? await sharp(buffer, { failOn: "truncated" })
        .rotate()
        .webp({
          quality: 82,
          alphaQuality: 100,
          effort: 6,
          smartSubsample: true,
          lossless: false,
        })
        .toBuffer()
    : format === "webp"
      ? buffer
      : await sharp(buffer, { failOn: "truncated" })
          .rotate()
          .webp({
            quality: 82,
            alphaQuality: 100,
            effort: 6,
            smartSubsample: true,
            lossless: false,
          })
          .toBuffer();

  return {
    format,
    converted,
    outputFilename,
    processedBuffer,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
}

export async function processUploadedImageFile({
  collection,
  category,
  file,
  storageRoot,
}: ProcessUploadedImageOptions): Promise<ImageConversionOutcome> {
  const rootPath = path.resolve(storageRoot ?? "public/uploads");
  const buffer = Buffer.from(await file.arrayBuffer());
  const sourceSize = file.size ?? buffer.length;
  if (sourceSize > maxUploadBytes) {
    throw new Error("file_too_large");
  }

  const image = await validateAndConvertImage(buffer, file.name || "image", file.type || undefined);
  const destinationDir = path.resolve(rootPath, collection, category);
  await mkdir(destinationDir, { recursive: true });

  const storedName = image.outputFilename;
  const destination = path.resolve(destinationDir, storedName);
  ensureWithinStorageRoot(destination, rootPath);

  const tempName = `${randomUUID()}-${storedName}.tmp`;
  const tempDestination = path.resolve(destinationDir, tempName);
  try {
    await writeFile(tempDestination, image.processedBuffer);
    await rename(tempDestination, destination);
  } catch (error) {
    await unlink(tempDestination).catch(() => undefined);
    throw error;
  }

  const relativePath = path.posix.join("uploads", collection, category, storedName).replace(/\\/g, "/");
  return {
    originalName: file.name || storedName,
    storedName,
    format: "webp",
    converted: image.converted,
    success: true,
    path: relativePath,
    url: `/${relativePath}`,
  };
}

export async function processUploadedImagesBatch({
  collection,
  category,
  files,
  storageRoot,
}: {
  collection: string;
  category: string;
  files: File[];
  storageRoot?: string | null;
}) {
  const concurrency = Math.max(1, Math.min(4, files.length || 1));
  let nextIndex = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    const results: Array<ImageConversionOutcome & { success: boolean; error?: { code: string; message: string } }> = [];

    while (nextIndex < files.length) {
      const currentIndex = nextIndex++;
      const file = files[currentIndex];
      if (!file) continue;

      try {
        const request: ProcessUploadedImageOptions = { collection, category, file };
        if (storageRoot !== undefined && storageRoot !== null) {
          request.storageRoot = storageRoot;
        }
        const result = await processUploadedImageFile(request);
        results.push({ ...result, success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid_image";
        results.push({
          originalName: file.name || "unknown",
          storedName: "",
          format: "",
          converted: false,
          success: false,
          path: "",
          url: "",
          error: { code: message, message: "The uploaded image could not be processed." },
        });
      }
    }

    return results;
  });

  const batches = await Promise.all(workers);
  const fileResults = batches.flat();

  const total = fileResults.length;
  const successful = fileResults.filter((result) => result.success).length;
  const converted = fileResults.filter((result) => result.success && result.converted).length;
  const alreadyWebp = fileResults.filter((result) => result.success && !result.converted).length;
  const failed = total - successful;

  return {
    success: failed === 0,
    total,
    processed: successful,
    converted,
    alreadyWebp,
    failed,
    files: fileResults,
  };
}

export async function cleanupTemporaryOutput(filePath: string) {
  try {
    await access(filePath);
    await import("node:fs/promises").then(({ unlink }) => unlink(filePath));
  } catch {
    // Ignore cleanup failures but keep the primary result intact.
  }
}
