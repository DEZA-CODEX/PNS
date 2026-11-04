import { useRoomImages } from "@/hooks/useRoomImages";
import { useDiningImages } from "@/hooks/useDiningImages";
import { DINING_TYPE_LABELS, ROOM_TYPE_LABELS } from "@/types/roomImages";
import { diningImageRepository } from "@/services/roomImageRepository";
import { gallery } from "@/home/data/homeData";

export function GalleryPreview() {
  const { images } = useRoomImages("gallery");
  const { images: diningImages } = useDiningImages("gallery");
  const previewItems = [
    ...images.slice(0, 2).map((image) => ({
      id: image.id,
      src: image.url,
      label: `${ROOM_TYPE_LABELS[image.roomType]} room`,
    })),
    ...diningImages.slice(0, 2).map((image) => ({
      id: image.id,
      src: image.url,
      label: `${DINING_TYPE_LABELS[image.diningType]} dining`,
    })),
    ...gallery.map((item) => ({ ...item, id: item.label })),
  ];

  return (
    <section id="gallery" className="bg-[var(--color-surface-cool)] py-24 lg:py-32">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <h2
          className="font-display text-[clamp(2.5rem,6vw,5.2rem)] text-cream"
          data-home-reveal
        >
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
              <img
                src={item.src}
                alt={item.label}
                loading="lazy"
                width="1200"
                height="800"
                onError={() => {
                  if (diningImages.some((image) => image.id === item.id)) {
                    diningImageRepository.reportUnavailable(item.id);
                  }
                }}
                className={`w-full object-cover transition-transform duration-1000 group-hover:scale-[1.02] ${
                  index === 0 ? "aspect-[16/8]" : index === 1 ? "aspect-[4/5]" : "aspect-[4/3]"
                }`}
              />
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
