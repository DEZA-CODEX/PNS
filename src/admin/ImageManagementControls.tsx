"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, apiResourceUrl } from "@/lib/api-client";

export type ManagedImageRecord = {
  id: string;
  category: string;
  url: string;
  path: string | null;
  sourceType: "bundled" | "upload" | "external";
  filename: string | null;
  displayLocation?: string;
  displayOrder?: number;
  active?: boolean;
};

type ImageManagementControlsProps = {
  collection: "room" | "dining";
  category: string;
  categoryLabel: string;
};

function notifyManagedImagesChanged(collection: "room" | "dining") {
  window.dispatchEvent(new CustomEvent("pns-managed-images-changed", { detail: { collection } }));
}

function safeImageSource(value: string) {
  value = apiResourceUrl(value);
  if ((value.startsWith("/") && !value.startsWith("//")) || value.startsWith("blob:")) {
    return value;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function safeImageDetails(value: string) {
  const source = safeImageSource(value);
  if (!source || typeof window === "undefined") return null;
  try {
    const parsed = new URL(source, window.location.origin);
    return { host: parsed.host, path: parsed.pathname };
  } catch {
    return null;
  }
}

function safeImageLabel(value: string) {
  const details = safeImageDetails(value);
  return details ? `${details.host}${details.path}` : "Invalid image URL";
}

export function ImageManagementControls({
  collection,
  category,
  categoryLabel,
}: ImageManagementControlsProps) {
  const [images, setImages] = useState<ManagedImageRecord[]>([]);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const endpoint = `/admin/${collection}-images`;

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!file) return;
    let cancelled = false;
    void createImageBitmap(file).then((bitmap) => {
      if (cancelled) {
        bitmap.close();
        return;
      }
      const scale = Math.min(176 / bitmap.width, 112 / bitmap.height);
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const requestHeaders = useMemo(() => ({}), []);

  const loadImages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${endpoint}?type=${encodeURIComponent(category)}`, {
        headers: requestHeaders,
      });
      const body = (await response.json()) as {
        images?: ManagedImageRecord[];
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Images could not be loaded.");
      setImages(body.images ?? []);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Images could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [category, endpoint, requestHeaders]);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  const resetForm = () => {
    setFile(null);
    setUrl("");
  };

  const addImage = async () => {
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      let response: Response;
      if (file) {
        const form = new FormData();
        form.set("category", category);
        form.set("file", file);
        response = await apiFetch(endpoint, {
          method: "POST",
          headers: requestHeaders,
          body: form,
          timeoutMs: 120_000,
        });
      } else {
        response = await apiFetch(endpoint, {
          method: "POST",
          headers: { ...requestHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ category, imageUrl: url.trim() }),
        });
      }
      const body = (await response.json()) as {
        error?: { message?: string };
        image?: ManagedImageRecord;
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Image could not be added.");
      resetForm();
      setFeedback("Image saved on the server.");
      if (body.image) {
        setImages((current) => [
          ...current.filter((candidate) => candidate.id !== body.image!.id),
          body.image!,
        ]);
      } else {
        await loadImages();
      }
      notifyManagedImagesChanged(collection);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Image could not be added.");
    } finally {
      setSaving(false);
    }
  };

  const deleteImage = async (image: ManagedImageRecord) => {
    if (!window.confirm(`Delete this image from ${categoryLabel}?`)) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const response = await apiFetch(
        `${endpoint}/${encodeURIComponent(image.id)}?type=${encodeURIComponent(category)}`,
        {
          method: "DELETE",
          headers: requestHeaders,
        },
      );
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Image could not be deleted.");
      setImages((current) => current.filter((candidate) => candidate.id !== image.id));
      notifyManagedImagesChanged(collection);
      setFeedback("Image deleted.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Image could not be deleted.");
    } finally {
      setSaving(false);
    }
  };

  const updatePlacement = async (image: ManagedImageRecord, displayLocation: string) => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`/admin/images/${encodeURIComponent(image.id)}`, {
        method: "PATCH",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ categoryType: collection, displayLocation }),
      });
      const body = (await response.json()) as {
        error?: { message?: string };
        image?: {
          id: string;
          display_location?: string;
          display_order?: number;
          is_active?: boolean;
        };
      };
      if (!response.ok)
        throw new Error(body.error?.message ?? "Image placement could not be saved.");
      if (body.image) {
        setImages((current) =>
          current.map((candidate) =>
            candidate.id === image.id
              ? (() => {
                  const updated = { ...candidate };
                  if (body.image!.display_location !== undefined)
                    updated.displayLocation = body.image!.display_location;
                  if (body.image!.display_order !== undefined)
                    updated.displayOrder = body.image!.display_order;
                  if (body.image!.is_active !== undefined) updated.active = body.image!.is_active;
                  return updated;
                })()
              : candidate,
          ),
        );
      }
      notifyManagedImagesChanged(collection);
      setFeedback("Display location saved.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Image placement could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const canSave = Boolean(file || url.trim()) && !saving;

  return (
    <section
      className="rounded-2xl border border-[var(--color-border-warm)] bg-white/50 p-5"
      aria-labelledby={`${collection}-${category}-crud-title`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-gold)]">
            Server-managed media
          </p>
          <h3
            id={`${collection}-${category}-crud-title`}
            className="mt-1 text-xl font-semibold text-[#051838]"
          >
            {categoryLabel} images
          </h3>
          <p className="mt-1 text-sm text-[#46536b]">
            {images.length} saved image{images.length === 1 ? "" : "s"}
          </p>
        </div>
        <p className="max-w-xs text-right text-xs text-[#46536b]">
          Protected by your admin session.
        </p>
      </div>

      <div className="mt-5 grid gap-3 rounded-xl border border-[var(--color-border-warm)] bg-white/60 p-4 md:grid-cols-[1fr_auto]">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm text-[#46536b]">
            Upload from computer
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setUrl("");
              }}
              disabled={saving}
              className="block w-full rounded-lg border border-[var(--color-border-warm)] bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="grid gap-1 text-sm text-[#46536b]">
            Add image URL
            <input
              type="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setFile(null);
              }}
              placeholder="https://example.com/image.webp"
              disabled={saving}
              className="rounded-lg border border-[var(--color-border-warm)] bg-white px-3 py-2 text-sm text-[#051838]"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            onClick={() => void addImage()}
            disabled={!canSave}
            className="luxury-button px-4 py-2 text-xs uppercase tracking-[0.1em] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save image"}
          </button>
          <button
            type="button"
            onClick={resetForm}
            disabled={saving}
            className="rounded-lg border border-[var(--color-border-warm)] px-4 py-2 text-xs text-[#051838] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {file ? (
          <div className="sm:col-span-2">
            <p className="mb-2 text-xs uppercase tracking-[0.12em] text-[#46536b]">Preview</p>
            <canvas
              ref={previewCanvasRef}
              aria-label="Selected image preview"
              className="h-28 w-44 rounded-lg object-cover"
            />
          </div>
        ) : url.trim() ? (
          <p className="sm:col-span-2 text-xs text-[#46536b]">
            External image preview will be available after saving.
          </p>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-[#46536b]" role="status">
          Loading images...
        </p>
      ) : null}
      {error ? (
        <p
          className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {feedback ? (
        <p
          className="mt-4 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900"
          role="status"
        >
          {feedback}
        </p>
      ) : null}
      {!loading && !error && images.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-[var(--color-border-warm)] p-5 text-sm text-[#46536b]">
          No server-managed images in this category.
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {images.map((image) => {
          const imageSource = safeImageSource(image.url);
          const imageFailed = failedImages.has(image.id) || !imageSource;
          return (
            <article
              key={image.id}
              className="overflow-hidden rounded-xl border border-[var(--color-border-warm)] bg-white"
            >
              {imageFailed ? (
                <div
                  className="flex aspect-[4/3] items-center justify-center bg-[#f3f4f6] px-4 text-center text-sm text-[#46536b]"
                  role="img"
                  aria-label={`${categoryLabel} image unavailable`}
                >
                  Image could not be loaded
                </div>
              ) : (
                <img
                  src={imageSource}
                  alt={`${categoryLabel} managed image`}
                  className="aspect-[4/3] w-full object-cover"
                  onError={() => {
                    console.warn("Managed image failed to load.", {
                      imageId: image.id,
                      sourceType: image.sourceType,
                      ...safeImageDetails(image.url),
                    });
                    setFailedImages((current) => new Set(current).add(image.id));
                  }}
                />
              )}
              <div className="grid gap-2 p-3 text-xs text-[#46536b]">
                <p className="font-medium text-[#051838]">
                  {image.sourceType === "external"
                    ? "External URL"
                    : image.sourceType === "bundled"
                      ? "Bundled website asset"
                      : "Uploaded image"}
                </p>
                <p className="break-all">
                  <strong>Image URL:</strong> {safeImageLabel(image.url)}
                </p>
                <p className="break-all">
                  <strong>
                    {image.sourceType === "upload" ? "Database filename:" : "Image path:"}
                  </strong>{" "}
                  {image.sourceType === "upload"
                    ? (image.filename ?? "Stored in PostgreSQL")
                    : (image.path ?? "External URL")}
                </p>
                <label className="grid gap-1 text-xs">
                  Display location
                  <select
                    value={image.displayLocation ?? "gallery"}
                    disabled={saving || image.sourceType === "bundled"}
                    onChange={(event) => void updatePlacement(image, event.target.value)}
                    className="rounded-lg border border-[var(--color-border-warm)] bg-white px-2 py-2 text-[#051838]"
                  >
                    <option value="homepage">Homepage</option>
                    <option value="room_listing">Room listing</option>
                    <option value="room_detail">Room detail</option>
                    <option value="dining_section">Dining section</option>
                    <option value="gallery">Gallery</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void deleteImage(image)}
                  disabled={saving}
                  className="mt-1 w-fit rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-800 disabled:opacity-50"
                >
                  Delete image
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
