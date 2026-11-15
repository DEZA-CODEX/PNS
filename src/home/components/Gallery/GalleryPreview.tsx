import { useEffect, useState } from "react";
import { useRoomImages } from "@/hooks/useRoomImages";
import { useDiningImages } from "@/hooks/useDiningImages";
import { DINING_TYPE_LABELS, ROOM_TYPE_LABELS } from "@/types/roomImages";
import type { RoomImage } from "@/types/roomImages";
import { diningImageRepository } from "@/services/roomImageRepository";
import { gallery } from "@/home/data/homeData";

type GalleryPreviewItem =
  | { kind: "vajra-carousel"; id: string; images: RoomImage[]; label: string }
  | {
      kind: "image";
      id: string;
      src: string;
      label: string;
      source: "room" | "dining" | "static";
    };

function VajraRoomCarousel({ images }: { images: RoomImage[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());
  const availableImages = images.filter((image) => !failedImageIds.has(image.id));
  const currentIndex = availableImages.length ? activeIndex % availableImages.length : 0;

  useEffect(() => {
    if (
      availableImages.length < 2 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % availableImages.length);
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [availableImages.length]);

  return (
    <div className="relative size-full overflow-hidden bg-[#051838]/5">
      {availableImages.map((image, index) => (
        <img
          key={image.id}
          src={image.url}
          alt={index === currentIndex ? image.altText : ""}
          aria-hidden={index !== currentIndex}
          width="1200"
          height="800"
          loading="eager"
          decoding="async"
          onError={() => {
            setFailedImageIds((current) => new Set(current).add(image.id));
            if (process.env.NODE_ENV === "development") {
              console.error(`Vajra room image failed to load (${image.filename}): ${image.url}`);
            }
          }}
          className={`absolute inset-0 size-full object-cover transition-[opacity,transform] duration-700 ease-in-out group-hover:scale-[1.02] ${
            index === currentIndex ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0"
          }`}
        />
      ))}
      {availableImages.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-[#46536b]">
          Vajra room images are temporarily unavailable.
        </div>
      ) : null}
    </div>
  );
}

export function GalleryPreview() {
  const { images } = useRoomImages("gallery");
  const { images: diningImages } = useDiningImages("gallery");
  const vajraImages = images.filter((image) => image.roomType === "vajra");
  const roomPreviewItems: GalleryPreviewItem[] = [
    ...(vajraImages.length > 0
      ? [
          {
            kind: "vajra-carousel" as const,
            id: "vajra-room-carousel",
            images: vajraImages,
            label: `${ROOM_TYPE_LABELS.vajra} room`,
          },
        ]
      : []),
    ...images
      .filter((image) => image.roomType !== "vajra")
      .slice(0, vajraImages.length > 0 ? 1 : 2)
      .map((image) => ({
        kind: "image" as const,
        id: image.id,
        src: image.url,
        label: `${ROOM_TYPE_LABELS[image.roomType]} room`,
        source: "room" as const,
      })),
  ];
  const previewItems: GalleryPreviewItem[] = [
    ...roomPreviewItems,
    ...diningImages.slice(0, 2).map((image) => ({
      kind: "image" as const,
      id: image.id,
      src: image.url,
      label: `${DINING_TYPE_LABELS[image.diningType]} dining`,
      source: "dining" as const,
    })),
    ...gallery.map((item) => ({
      kind: "image" as const,
      ...item,
      id: item.label,
      source: "static" as const,
    })),
  ];

  return (
    <section id="gallery" className="bg-[var(--color-surface-cool)] py-24 lg:py-32">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <h2 className="font-display text-[clamp(2.5rem,6vw,5.2rem)] text-cream" data-home-reveal>
          See the spaces.
        </h2>
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-12">
          {previewItems.map((item, index) => (
            <figure
              key={item.id}
              className={`group ${
                index === 0
                  ? "lg:col-span-7"
                  : index === 1
                    ? "sm:col-span-1 lg:col-span-5 lg:mt-16"
                    : index === 2
                      ? "sm:col-span-1 lg:col-span-4"
                      : index === 3
                        ? "sm:col-span-1 lg:col-span-4 lg:mt-16"
                        : "sm:col-span-1 lg:col-span-4"
              }`}
              data-home-reveal
            >
              <div
                className={`relative overflow-hidden bg-[#051838]/5 ${
                  index === 0 ? "aspect-[16/8]" : index === 1 ? "aspect-[4/5]" : "aspect-[4/3]"
                }`}
              >
                {item.kind === "vajra-carousel" ? (
                  <VajraRoomCarousel images={item.images} />
                ) : (
                  <img
                    src={item.src}
                    alt={item.label}
                    loading="lazy"
                    width="1200"
                    height="800"
                    onError={() => {
                      if (item.source === "dining") {
                        diningImageRepository.reportUnavailable(item.id);
                      }
                    }}
                    className="size-full object-cover transition-transform duration-1000 group-hover:scale-[1.02]"
                  />
                )}
              </div>
              <figcaption className="eyebrow mt-4">{item.label}</figcaption>
            </figure>
          ))}
        </div>
        <a href="/gallery" className="text-link mt-6">
          View full gallery
        </a>
      </div>
    </section>
  );
}
