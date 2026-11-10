import { useState } from "react";
import { ImageManagementControls } from "@/admin/ImageManagementControls";
import { getRoomImageCounts, roomImageRepository } from "@/services/roomImageRepository";
import { useRoomImageLibrary } from "@/hooks/useRoomImages";
import {
  ROOM_IMAGE_DESTINATIONS,
  ROOM_TYPE_LABELS,
  ROOM_TYPES,
  type RoomImageDestination,
  type RoomType,
} from "@/types/roomImages";

type SelectionFilter = "all" | RoomImageDestination;

const destinationLabels: Record<RoomImageDestination, string> = {
  homepage: "Homepage",
  roomsPage: "Rooms page",
  gallery: "Gallery",
};

const filters: { id: SelectionFilter; label: string }[] = [
  { id: "all", label: "All images" },
  { id: "homepage", label: "Homepage selected" },
  { id: "roomsPage", label: "Rooms page selected" },
  { id: "gallery", label: "Gallery selected" },
];

export function RoomImageManagement() {
  const { images, warnings, error: loadError } = useRoomImageLibrary();
  const [roomType, setRoomType] = useState<RoomType>("vajra");
  const [filter, setFilter] = useState<SelectionFilter>("all");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());

  const roomImages = images.filter((image) => image.roomType === roomType);
  const counts = getRoomImageCounts(images, roomType);
  const visibleImages =
    filter === "all" ? roomImages : roomImages.filter((image) => image.selections[filter]);
  const displayedError = loadError ?? error;

  const updateSelection = async (
    imageId: string,
    destination: RoomImageDestination,
    selected: boolean,
  ) => {
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await roomImageRepository.updateSelection(imageId, destination, selected);
      setFeedback("Selection saved to the image record.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "The selection could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="room-image-management-title" className="space-y-6">
      <div className="rounded-2xl border border-[var(--color-border-warm)] bg-white/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-gold)]">
              Website media
            </p>
            <h2
              id="room-image-management-title"
              className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]"
            >
              Room Image Management
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--color-text-primary)]/70">
              Selections are saved with each image and control where it appears on the website.
            </p>
          </div>
          <span className="rounded-full border border-[var(--color-border-warm)] px-3 py-1 text-xs text-[var(--color-text-primary)]/70">
            {roomImages.length} {roomImages.length === 1 ? "image" : "images"}
          </span>
        </div>

        <div
          className="mt-6 grid gap-3 sm:grid-cols-3"
          aria-label={`${ROOM_TYPE_LABELS[roomType]} selection counts`}
        >
          {ROOM_IMAGE_DESTINATIONS.map((destination) => (
            <div
              key={destination}
              className="rounded-xl border border-[var(--color-border-warm)] bg-white/60 p-4"
            >
              <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-text-primary)]/60">
                {destinationLabels[destination]}
              </p>
              <p className="mt-2 text-lg font-semibold text-[#051838]">
                {counts[destination]} selected
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Room categories">
        {ROOM_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={roomType === type}
            onClick={() => {
              setRoomType(type);
              setFeedback(null);
              setError(null);
            }}
            className={`rounded-full border px-4 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#051838] ${
              roomType === type
                ? "border-[#051838] bg-[#051838] text-white"
                : "border-[var(--color-border-warm)] bg-white/60 text-[#051838] hover:bg-white"
            }`}
          >
            {ROOM_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      <ImageManagementControls
        collection="room"
        category={roomType}
        categoryLabel={ROOM_TYPE_LABELS[roomType]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter room images">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#051838] ${
                filter === item.id
                  ? "bg-[rgba(207,140,85,0.18)] text-[#051838]"
                  : "bg-white/50 text-[#46536b] hover:bg-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[#46536b]" role="status" aria-live="polite">
          {saving ? "Saving selection…" : feedback}
        </p>
      </div>

      {displayedError ? (
        <p
          className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          {displayedError}
        </p>
      ) : null}
      {warnings.map((warning) => (
        <p
          key={warning}
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          {warning}
        </p>
      ))}

      {roomImages.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border-warm)] bg-white/30 p-8 text-center">
          <h3 className="font-semibold text-[#051838]">
            No {ROOM_TYPE_LABELS[roomType]} room images found
          </h3>
          <p className="mt-2 text-sm text-[#46536b]">
            Add a valid image to <code>src/assets/rooms/{roomType}/</code> and rebuild the site.
            Selection minimums cannot be met until an image is available.
          </p>
        </div>
      ) : visibleImages.length === 0 ? (
        <p className="rounded-xl border border-[var(--color-border-warm)] bg-white/30 p-6 text-sm text-[#46536b]">
          No images in this room match the selected filter.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleImages.map((image) => (
            <article
              key={image.id}
              className="overflow-hidden rounded-2xl border border-[var(--color-border-warm)] bg-white/60 shadow-[0_18px_45px_-30px_rgba(5,24,56,0.3)]"
            >
              <div className="aspect-[4/3] bg-[#051838]/5">
                {failedImages.has(image.id) ? (
                  <div className="flex size-full items-center justify-center px-4 text-center text-sm text-[#46536b]">
                    Image unavailable
                  </div>
                ) : (
                  <img
                    src={image.url}
                    alt={image.altText}
                    width="1200"
                    height="900"
                    loading="lazy"
                    className="size-full object-cover"
                    onError={() => {
                      setFailedImages((current) => new Set(current).add(image.id));
                      if (process.env.NODE_ENV === "development") {
                        console.error(
                          `Room image failed to load (${image.roomType}/${image.filename}): ${image.url}`,
                        );
                      }
                    }}
                  />
                )}
              </div>
              <div className="p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-gold)]">
                  {ROOM_TYPE_LABELS[image.roomType]}
                </p>
                <h3 className="mt-1 truncate font-medium text-[#051838]" title={image.filename}>
                  {image.filename}
                </h3>
                <fieldset className="mt-4 grid gap-2 border-t border-[var(--color-border-warm)] pt-3">
                  <legend className="sr-only">Display destinations for {image.filename}</legend>
                  {ROOM_IMAGE_DESTINATIONS.map((destination) => {
                    const isLastSelected =
                      image.selections[destination] && counts[destination] === 1;
                    return (
                      <label
                        key={destination}
                        className="flex min-h-8 items-center gap-2 text-sm text-[#46536b]"
                      >
                        <input
                          type="checkbox"
                          checked={image.selections[destination]}
                          disabled={saving || isLastSelected}
                          aria-describedby={
                            isLastSelected ? `${image.id}-${destination}-minimum` : undefined
                          }
                          onChange={(event) =>
                            void updateSelection(image.id, destination, event.target.checked)
                          }
                          className="size-4 accent-[#051838] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#051838] disabled:cursor-not-allowed"
                        />
                        {destinationLabels[destination]}
                        {isLastSelected ? (
                          <span
                            id={`${image.id}-${destination}-minimum`}
                            className="ml-auto text-xs text-[#46536b]/70"
                          >
                            At least one {ROOM_TYPE_LABELS[roomType]} image must remain selected for
                            the {destinationLabels[destination].toLowerCase()}.
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </fieldset>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
