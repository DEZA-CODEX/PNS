import { useState } from "react";
import { ImageManagementControls } from "@/admin/ImageManagementControls";
import { diningImageRepository, getDiningImageCounts } from "@/services/roomImageRepository";
import { useDiningImageLibrary } from "@/hooks/useDiningImages";
import {
  DINING_IMAGE_DESTINATIONS,
  DINING_TYPE_LABELS,
  DINING_TYPES,
  type DiningDisplayDestination,
  type DiningImageDestination,
  type DiningType,
} from "@/types/roomImages";

type ImageFilter = "all" | DiningImageDestination;

const destinationLabels: Record<DiningImageDestination, string> = {
  homepage: "Homepage",
  diningPage: "Dining page",
  diningHero: "Dining hero",
  aboutPage: "About page",
  gallery: "Gallery",
};

const filters: { id: ImageFilter; label: string }[] = [
  { id: "all", label: "All images" },
  ...DINING_IMAGE_DESTINATIONS.map((id) => ({
    id,
    label: `${destinationLabels[id]} selected`,
  })),
];

const countDestinations: DiningDisplayDestination[] = ["diningPage", "diningHero"];

export function DiningImageManagement() {
  const { images, warnings, error: loadError, displayCounts } = useDiningImageLibrary();
  const [diningType, setDiningType] = useState<DiningType>("vrindavan");
  const [filter, setFilter] = useState<ImageFilter>("all");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());

  const categoryImages = images.filter((image) => image.diningType === diningType);
  const counts = getDiningImageCounts(images, diningType);
  const visibleImages =
    filter === "all" ? categoryImages : categoryImages.filter((image) => image.selections[filter]);
  const displayedError = loadError ?? error;

  const save = async (operation: () => Promise<unknown>, successMessage: string) => {
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await operation();
      setFeedback(successMessage);
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : "Dining-image settings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const changeCount = (destination: DiningDisplayDestination, count: 1 | 2 | 3) =>
    save(
      () => diningImageRepository.updateDisplayCount(diningType, destination, count),
      "Display count saved in this browser.",
    );

  const updateSelection = (
    imageId: string,
    destination: DiningImageDestination,
    selected: boolean,
  ) =>
    save(
      () => diningImageRepository.updateSelection(imageId, destination, selected),
      "Selection saved to the image record.",
    );

  return (
    <section aria-labelledby="dining-image-management-title" className="space-y-6">
      <div className="rounded-2xl border border-[var(--color-border-warm)] bg-white/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-gold)]">
              Website media
            </p>
            <h2
              id="dining-image-management-title"
              className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]"
            >
              Dining Image Management
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--color-text-primary)]/70">
              Selections are saved with each image; display counts remain specific to this browser.
            </p>
          </div>
          <span className="rounded-full border border-[var(--color-border-warm)] px-3 py-1 text-xs text-[var(--color-text-primary)]/70">
            {categoryImages.length} {categoryImages.length === 1 ? "image" : "images"}
          </span>
        </div>
        <div
          className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
          aria-label={`${DINING_TYPE_LABELS[diningType]} selection counts`}
        >
          {DINING_IMAGE_DESTINATIONS.map((destination) => (
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
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {countDestinations.map((destination) => {
            const available = counts[destination];
            const label = destination === "diningPage" ? "Dining page" : "Dining hero";
            return (
              <div
                key={destination}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border-warm)] bg-white/60 p-4 text-sm text-[#051838]"
              >
                <label htmlFor={`dining-count-${diningType}-${destination}`}>
                  {label} images shown at once
                </label>
                <select
                  id={`dining-count-${diningType}-${destination}`}
                  value={displayCounts[diningType][destination]}
                  onChange={(event) =>
                    void changeCount(destination, Number(event.target.value) as 1 | 2 | 3)
                  }
                  disabled={saving || available === 0}
                  className="rounded-lg border border-[var(--color-border-warm)] bg-white px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#051838]"
                  aria-label={`${label} display count for ${DINING_TYPE_LABELS[diningType]}`}
                  aria-describedby={`dining-count-help-${diningType}-${destination}`}
                >
                  {[1, 2, 3].map((count) => (
                    <option key={count} value={count} disabled={count > available}>
                      {count} {count === 1 ? "image" : "images"}
                    </option>
                  ))}
                </select>
                <p
                  id={`dining-count-help-${diningType}-${destination}`}
                  className="basis-full text-xs text-[#46536b]"
                >
                  {available < 3
                    ? `Only ${available} eligible ${DINING_TYPE_LABELS[diningType]} image${available === 1 ? " is" : "s are"} selected for the ${label}; higher count choices are disabled until more images are selected.`
                    : `Choose 1, 2, or 3 selected ${DINING_TYPE_LABELS[diningType]} images for the ${label}.`}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Dining categories">
        {DINING_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={diningType === type}
            onClick={() => {
              setDiningType(type);
              setFeedback(null);
              setError(null);
            }}
            className={`rounded-full border px-4 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#051838] ${
              diningType === type
                ? "border-[#051838] bg-[#051838] text-white"
                : "border-[var(--color-border-warm)] bg-white/60 text-[#051838] hover:bg-white"
            }`}
          >
            {DINING_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      <ImageManagementControls
        collection="dining"
        category={diningType}
        categoryLabel={DINING_TYPE_LABELS[diningType]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter dining images">
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
          {saving ? "Saving…" : feedback}
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
      {warnings
        .filter(
          (warning) =>
            warning.includes(`/${diningType}/`) || warning.includes(DINING_TYPE_LABELS[diningType]),
        )
        .map((warning) => (
          <p
            key={warning}
            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            role="status"
          >
            {warning}
          </p>
        ))}

      {categoryImages.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border-warm)] bg-white/30 p-8 text-center">
          <h3 className="font-semibold text-[#051838]">
            No {DINING_TYPE_LABELS[diningType]} dining images found
          </h3>
          <p className="mt-2 text-sm text-[#46536b]">
            Add a supported image to <code>src/assets/dining/{diningType}/</code> and rebuild the
            site.
          </p>
        </div>
      ) : visibleImages.length === 0 ? (
        <p className="rounded-xl border border-[var(--color-border-warm)] bg-white/30 p-6 text-sm text-[#46536b]">
          No images in this category match the selected filter.
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
                    loading="lazy"
                    width="1200"
                    height="900"
                    onError={() => {
                      setFailedImages((current) => new Set(current).add(image.id));
                      diningImageRepository.reportUnavailable(image.id);
                    }}
                    className="size-full object-cover"
                  />
                )}
              </div>
              <div className="space-y-4 p-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-gold)]">
                    {DINING_TYPE_LABELS[image.diningType]}
                  </p>
                  <h3 className="mt-1 break-all font-semibold text-[#051838]">{image.filename}</h3>
                </div>
                <fieldset className="space-y-3" disabled={saving || failedImages.has(image.id)}>
                  <legend className="sr-only">Display destinations for {image.filename}</legend>
                  {DINING_IMAGE_DESTINATIONS.map((destination) => {
                    const selectedInDestination = counts[destination];
                    const countLimit =
                      destination === "diningPage" || destination === "diningHero"
                        ? displayCounts[diningType][destination]
                        : 1;
                    const lastOrRequired =
                      image.selections[destination] && selectedInDestination <= countLimit;
                    const label = destinationLabels[destination];
                    const minimumLabel =
                      destination === "diningPage"
                        ? "the Dining page"
                        : destination === "diningHero"
                          ? "the Dining hero"
                          : `the ${label}`;
                    return (
                      <label
                        key={destination}
                        className="flex items-start gap-2 text-sm text-[#24334d]"
                      >
                        <input
                          type="checkbox"
                          checked={image.selections[destination]}
                          disabled={lastOrRequired}
                          onChange={(event) =>
                            void updateSelection(image.id, destination, event.target.checked)
                          }
                          aria-label={`${label}${lastOrRequired ? ` At least ${countLimit} ${DINING_TYPE_LABELS[diningType]} image${countLimit > 1 ? "s" : ""} must remain selected for ${minimumLabel}.` : ""}`}
                          className="mt-0.5 size-4 accent-[#051838] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#051838]"
                        />
                        <span>
                          {label}
                          {lastOrRequired ? (
                            <span className="block text-xs text-[#46536b]">
                              Keep at least {countLimit} selected for {minimumLabel}.
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
                <label className="flex items-center gap-2 border-t border-[var(--color-border-warm)] pt-3 text-sm text-[#24334d]">
                  Display order
                  <input
                    type="number"
                    min="0"
                    defaultValue={image.displayOrder}
                    disabled={saving || failedImages.has(image.id)}
                    aria-label={`Display order for ${image.filename}`}
                    onBlur={(event) => {
                      const displayOrder = Number(event.currentTarget.value);
                      if (displayOrder !== image.displayOrder) {
                        void save(
                          () => diningImageRepository.updateDisplayOrder(image.id, displayOrder),
                          "Display order saved in this browser.",
                        );
                      }
                    }}
                    className="w-20 rounded border border-[var(--color-border-warm)] bg-white px-2 py-1"
                  />
                  <span className="text-xs text-[#46536b]">Lower numbers appear first</span>
                </label>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
