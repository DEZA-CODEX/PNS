"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/sections/Footer";
import { BookingPanel } from "@/components/BookingPanel";
import type { BookingDetails } from "@/home/components/Booking/BookingWidget";
import { galleryImages, type GalleryCategory, type GalleryImage } from "@/data/gallery";
import { useRoomImages } from "@/hooks/useRoomImages";
import { useDiningImages } from "@/hooks/useDiningImages";
import { DINING_TYPES, DINING_TYPE_LABELS, ROOM_TYPES, ROOM_TYPE_LABELS } from "@/types/roomImages";
import { diningImageRepository } from "@/services/roomImageRepository";

const categories: GalleryCategory[] = ["All", "Rooms", "Dining", "Hotel", "Events", "Exterior"];

export function Gallery() {
  const [category, setCategory] = useState<GalleryCategory>("All");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [tilt, setTilt] = useState({ x: "0deg", y: "0deg" });
  const { images: roomGalleryImages } = useRoomImages("gallery");
  const { images: diningGalleryImages } = useDiningImages("gallery");
  const swipeStart = useRef<number | null>(null);
  const roomImages = useMemo<GalleryImage[]>(
    () =>
      roomGalleryImages.map((image) => ({
        id: image.id,
        src: image.url,
        title: `${ROOM_TYPE_LABELS[image.roomType]} room`,
        category: "Rooms",
        alt: image.altText,
        roomType: image.roomType,
      })),
    [roomGalleryImages],
  );
  const diningImages = useMemo<GalleryImage[]>(
    () =>
      diningGalleryImages.map((image) => ({
        id: image.id,
        src: image.url,
        title: `${DINING_TYPE_LABELS[image.diningType]} dining`,
        category: "Dining",
        alt: image.altText,
        diningType: image.diningType,
      })),
    [diningGalleryImages],
  );
  const allImages = useMemo(
    () => [...roomImages, ...diningImages, ...galleryImages],
    [roomImages, diningImages],
  );
  const visibleImages = useMemo(
    () =>
      category === "All" ? allImages : allImages.filter((image) => image.category === category),
    [allImages, category],
  );
  const roomSections = category === "All" || category === "Rooms";
  const nonRoomImages = visibleImages.filter(
    (image) => image.roomType === undefined && image.diningType === undefined,
  );
  const diningSections = category === "All" || category === "Dining";
  const activeIndex = visibleImages.findIndex((image) => image.id === activeId);
  const activeImage = activeIndex >= 0 ? visibleImages[activeIndex] : null;
  const bookingDetails: BookingDetails = {
    roomTypes: [],
    checkIn: "",
    checkOut: "",
    adults: 2,
    children: 0,
    rooms: 1,
    travelingForWork: false,
    travelingWithPets: false,
  };

  const closeLightbox = useCallback(() => setActiveId(null), []);
  const showImage = useCallback(
    (direction: number) => {
      if (!visibleImages.length) return;
      const nextIndex =
        (Math.max(activeIndex, 0) + direction + visibleImages.length) % visibleImages.length;
      setActiveId(visibleImages[nextIndex]!.id);
    },
    [activeIndex, visibleImages],
  );

  useEffect(() => {
    if (!activeImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeLightbox();
      if (event.key === "ArrowRight") showImage(1);
      if (event.key === "ArrowLeft") showImage(-1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeImage, closeLightbox, showImage]);

  return (
    <div className="readable-content min-h-screen bg-background">
      <Navbar onBook={() => setBooking(true)} />
      <main>
        <section className="gallery-hero dark-surface relative overflow-hidden px-6 pb-16 pt-40 lg:px-12 lg:pb-24 lg:pt-52">
          <div className="mx-auto grid max-w-[1400px] items-end gap-10 lg:grid-cols-[1fr_0.8fr]">
            <div>
              <p className="eyebrow text-gold">Gallery / PNS Nakshatra</p>
              <h1 className="mt-5 max-w-4xl font-display text-[clamp(4rem,10vw,10rem)] leading-[0.78] text-[var(--color-ivory)]">
                A place with a <span className="italic text-gold">point of view.</span>
              </h1>
            </div>
            <div className="max-w-[80%]">
              <img
                src={galleryImages[0]?.src}
                alt={galleryImages[0]?.alt || "Hotel PNS Nakshatra gallery preview"}
                className="mb-4 h-100 w-full rounded-md object-cover opacity-90"
                loading="lazy"
              />
              <p className="text-base leading-relaxed text-[var(--color-ivory)]/85">
                A visual study of rooms, dining, gathering and the evening character of Hotel PNS
                Nakshatra.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-[var(--color-surface-cool)] px-6 py-16 lg:px-12 lg:py-24">
          <div className="mx-auto max-w-[1400px]">
            <div className="flex flex-wrap items-center justify-between gap-5 border-b border-gold/40 pb-5">
              <div className="flex flex-wrap gap-5" role="tablist" aria-label="Gallery categories">
                {categories.map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={category === item}
                    onClick={() => {
                      setCategory(item);
                      setActiveId(null);
                    }}
                    className={`eyebrow transition-colors ${category === item ? "text-gold" : "text-ink/70 hover:text-ink"}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <p className="eyebrow text-ink/60">{visibleImages.length} views</p>
            </div>

            {roomSections || diningSections ? (
              <div className="mt-12 space-y-12">
                {ROOM_TYPES.map((roomType) => {
                  const roomImages = visibleImages.filter((image) => image.roomType === roomType);
                  if (!roomImages.length) return null;
                  return (
                    <section key={roomType} aria-labelledby={`gallery-${roomType}`}>
                      <h2 id={`gallery-${roomType}`} className="eyebrow mb-5 text-ink">
                        {ROOM_TYPE_LABELS[roomType]}
                      </h2>
                      <div className="gallery-spatial-stage">
                        {roomImages.map((image, index) => (
                          <button
                            key={image.id}
                            type="button"
                            className={`gallery-spatial-card gallery-spatial-card-${index % 5}`}
                            onClick={() => setActiveId(image.id)}
                            aria-label={`Open ${image.title}`}
                          >
                            <img
                              src={image.src}
                              alt={image.alt}
                              loading="lazy"
                              width="1200"
                              height="900"
                              onError={() => diningImageRepository.reportUnavailable(image.id)}
                            />
                            <span>
                              <small>{image.category}</small>
                              {image.title}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })}
                {diningSections
                  ? DINING_TYPES.map((diningType) => {
                      const images = visibleImages.filter(
                        (image) => image.diningType === diningType,
                      );
                      if (!images.length) return null;
                      return (
                        <section key={diningType} aria-labelledby={`gallery-${diningType}`}>
                          <h2 id={`gallery-${diningType}`} className="eyebrow mb-5 text-ink">
                            {DINING_TYPE_LABELS[diningType]}
                          </h2>
                          <div className="gallery-spatial-stage">
                            {images.map((image, index) => (
                              <button
                                key={image.id}
                                type="button"
                                className={`gallery-spatial-card gallery-spatial-card-${index % 5}`}
                                onClick={() => setActiveId(image.id)}
                                aria-label={`Open ${image.title}`}
                              >
                                <img
                                  src={image.src}
                                  alt={image.alt}
                                  loading="lazy"
                                  width="1200"
                                  height="900"
                                />
                                <span>
                                  <small>{image.category}</small>
                                  {image.title}
                                </span>
                              </button>
                            ))}
                          </div>
                        </section>
                      );
                    })
                  : null}
                {nonRoomImages.length > 0 ? (
                  <div className="gallery-spatial-stage">
                    {nonRoomImages.map((image, index) => (
                      <button
                        key={image.id}
                        type="button"
                        className={`gallery-spatial-card gallery-spatial-card-${index % 5}`}
                        onClick={() => setActiveId(image.id)}
                        aria-label={`Open ${image.title}`}
                      >
                        <img
                          src={image.src}
                          alt={image.alt}
                          loading="lazy"
                          width="1200"
                          height="900"
                        />
                        <span>
                          <small>{image.category}</small>
                          {image.title}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                className="gallery-spatial-stage mt-12"
                style={
                  {
                    "--gallery-rotate-x": tilt.x,
                    "--gallery-rotate-y": tilt.y,
                  } as React.CSSProperties
                }
                onPointerMove={(event) => {
                  if (event.pointerType !== "mouse") return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  setTilt({
                    x: `${((event.clientY - rect.top) / rect.height - 0.5) * -3}deg`,
                    y: `${((event.clientX - rect.left) / rect.width - 0.5) * 4}deg`,
                  });
                }}
                onPointerLeave={() => setTilt({ x: "0deg", y: "0deg" })}
                onPointerDown={(event) => {
                  if (event.pointerType === "touch") swipeStart.current = event.clientX;
                }}
                onPointerUp={(event) => {
                  if (swipeStart.current === null || !activeImage) return;
                  const distance = event.clientX - swipeStart.current;
                  swipeStart.current = null;
                  if (Math.abs(distance) > 40) showImage(distance < 0 ? 1 : -1);
                }}
              >
                {visibleImages.map((image, index) => (
                  <button
                    key={image.id}
                    type="button"
                    className={`gallery-spatial-card gallery-spatial-card-${index % 5}`}
                    onClick={() => setActiveId(image.id)}
                    aria-label={`Open ${image.title}`}
                  >
                    <img
                      src={image.src}
                      alt={image.alt}
                      loading={index < 3 ? "eager" : "lazy"}
                      width="1200"
                      height="900"
                    />
                    <span>
                      <small>{image.category}</small>
                      {image.title}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <Footer onBook={() => setBooking(true)} />
      <BookingPanel open={booking} details={bookingDetails} onClose={() => setBooking(false)} />

      {activeImage ? (
        <div
          className="gallery-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${activeImage.title} image viewer`}
          onClick={closeLightbox}
        >
          <button
            type="button"
            className="gallery-lightbox-close"
            onClick={closeLightbox}
            aria-label="Close gallery"
          >
            <X className="size-5" />
          </button>
          <button
            type="button"
            className="gallery-lightbox-nav gallery-lightbox-prev"
            onClick={(event) => {
              event.stopPropagation();
              showImage(-1);
            }}
            aria-label="Previous image"
          >
            <ChevronLeft className="size-6" />
          </button>
          <figure className="gallery-lightbox-figure" onClick={(event) => event.stopPropagation()}>
            <img
              src={activeImage.src}
              alt={activeImage.alt}
              onError={() => {
                if (activeImage.diningType) {
                  diningImageRepository.reportUnavailable(activeImage.id);
                  closeLightbox();
                }
              }}
            />
            <figcaption>
              <span className="eyebrow text-gold">{activeImage.category}</span>
              <strong>{activeImage.title}</strong>
            </figcaption>
          </figure>
          <button
            type="button"
            className="gallery-lightbox-nav gallery-lightbox-next"
            onClick={(event) => {
              event.stopPropagation();
              showImage(1);
            }}
            aria-label="Next image"
          >
            <ChevronRight className="size-6" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
