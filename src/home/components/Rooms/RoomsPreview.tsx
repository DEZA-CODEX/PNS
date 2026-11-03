import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { roomCategories, type Room } from "@/data/rooms";
import type { BookingDetails } from "@/home/components/Booking/BookingWidget";
import { useRoomImages } from "@/hooks/useRoomImages";
import type { RoomImage } from "@/types/roomImages";

type RoomsPreviewProps = {
  onBook?: (details?: BookingDetails) => void;
};

function setPanelTilt(element: HTMLElement, event: PointerEvent<HTMLElement>) {
  if (event.pointerType !== "mouse") return;
  const bounds = element.getBoundingClientRect();
  const rotateX = ((event.clientY - bounds.top) / bounds.height - 0.5) * -3;
  const rotateY = ((event.clientX - bounds.left) / bounds.width - 0.5) * 4;
  element.style.setProperty("--panel-rotate-x", `${rotateX}deg`);
  element.style.setProperty("--panel-rotate-y", `${rotateY}deg`);
}

function RoomPanel({
  room,
  images,
  active,
  onSelect,
  onBook,
}: {
  room: Room;
  images: RoomImage[];
  active: boolean;
  onSelect: () => void;
  onBook?: (details?: BookingDetails) => void;
}) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const imageIds = images.map((image) => image.id).join("|");

  useEffect(() => {
    setActiveImageIndex(0);
    if (images.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(
      () => setActiveImageIndex((current) => (current + 1) % images.length),
      6000,
    );
    return () => window.clearInterval(timer);
  }, [imageIds, images.length]);

  return (
    <article
      className={`editorial-carousel-item group relative min-h-[15rem] overflow-hidden border border-gold/40 ${
        active ? "editorial-carousel-item-active md:col-span-7 md:row-span-2" : "md:col-span-5"
      }`}
      data-active={active}
      data-home-reveal
      onMouseEnter={onSelect}
      onPointerMove={(event) => setPanelTilt(event.currentTarget, event)}
      onPointerLeave={(event) => {
        event.currentTarget.style.setProperty("--panel-rotate-x", "0deg");
        event.currentTarget.style.setProperty("--panel-rotate-y", "0deg");
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        onFocus={onSelect}
        aria-label={`Show ${room.name}, ${room.category}`}
        aria-pressed={active}
        className="absolute inset-0 z-10 cursor-pointer"
      />
      {images.map((image, index) => (
        <img
          key={image.id}
          src={image.url}
          alt={image.altText}
          loading={active && index === activeImageIndex ? "eager" : "lazy"}
          fetchPriority={active && index === activeImageIndex ? "high" : "auto"}
          width="1200"
          height="800"
          aria-hidden={index !== activeImageIndex}
          className={`absolute inset-0 size-full min-h-[15rem] object-cover transition-[opacity,transform] duration-[1200ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04] md:min-h-[25rem] ${
            index === activeImageIndex ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/15 to-transparent" />
      <div className="pointer-events-none absolute inset-x-6 bottom-6 z-20 md:inset-x-8 md:bottom-8">
        <p className="eyebrow text-gold">{room.category}</p>
        <h3
          className={`mt-2 font-display leading-none text-[var(--color-ivory)] ${
            active ? "text-5xl md:text-7xl" : "text-4xl"
          }`}
        >
          {room.name}
        </h3>
        <div
          className={`overflow-hidden transition-[max-height,opacity,transform] duration-700 ${
            active ? "mt-4 max-h-52 translate-y-0 opacity-100" : "max-h-0 translate-y-3 opacity-0"
          }`}
        >
          <p className="editorial-panel-copy max-w-xl text-sm leading-relaxed">
            {room.description}
          </p>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-cream/80">
            {room.amenities.map((amenity) => (
              <span key={amenity} className="editorial-panel-copy eyebrow text-[0.62rem]">
                {amenity}
              </span>
            ))}
          </div>
          <div className="pointer-events-auto mt-5 flex flex-wrap items-center gap-4">
            <a
              href={room.detailsUrl}
              target="_blank"
              rel="noreferrer"
              className="editorial-panel-button luxury-button-ghost px-4 py-2"
            >
              Room details
            </a>
            {onBook ? (
              <button
                type="button"
                onClick={() => onBook()}
                className="luxury-button luxury-button-hover px-4 py-2"
              >
                Book this room
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export function RoomsPreview({ onBook }: RoomsPreviewProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const swipeStart = useRef<number | null>(null);
  const { images } = useRoomImages("homepage");
  const orderedRooms = useMemo(
    () => [
      roomCategories[activeIndex]!,
      ...roomCategories.filter((_, index) => index !== activeIndex),
    ],
    [activeIndex],
  );

  const changeBy = (direction: number) => {
    setActiveIndex(
      (current) => (current + direction + roomCategories.length) % roomCategories.length,
    );
  };

  return (
    <section id="stay" className="bg-[var(--color-surface-blue-soft)] px-6 py-24 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-[1400px]">
        <h2
          className="max-w-4xl font-display text-[clamp(2.8rem,7vw,6rem)] leading-[0.86] tracking-[-0.02em] text-cream"
          data-home-reveal
        >
          Luxury rooms <span className="italic text-gold">&amp; suites</span>
        </h2>
        <p className="mt-7 max-w-lg text-sm leading-relaxed text-muted-foreground" data-home-reveal>
          Five considered spaces, each with its own rhythm, proportion and point of view.
        </p>
        <div
          role="region"
          aria-roledescription="carousel"
          className="editorial-carousel editorial-carousel-rooms mt-12 grid gap-3 md:auto-rows-[minmax(12rem,1fr)] md:grid-cols-12 md:gap-4"
          onPointerDown={(event) => {
            if (event.pointerType === "touch") swipeStart.current = event.clientX;
          }}
          onPointerUp={(event) => {
            if (swipeStart.current === null) return;
            const distance = event.clientX - swipeStart.current;
            swipeStart.current = null;
            if (Math.abs(distance) > 40) changeBy(distance < 0 ? 1 : -1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") changeBy(1);
            if (event.key === "ArrowLeft") changeBy(-1);
          }}
          tabIndex={0}
          aria-label="Room showcase"
        >
          {orderedRooms.map((room) => (
            <RoomPanel
              key={room.id}
              room={room}
              images={images.filter((image) => image.roomType === room.id)}
              active={room.id === roomCategories[activeIndex]?.id}
              onSelect={() =>
                setActiveIndex(roomCategories.findIndex((item) => item.id === room.id))
              }
              {...(onBook ? { onBook } : {})}
            />
          ))}
        </div>
        <div className="mt-6 flex items-center justify-between border-t border-gold/40 pt-4">
          <p className="eyebrow">
            0{activeIndex + 1} / 05 · {roomCategories[activeIndex]?.category}
          </p>
          <div role="group" className="flex gap-1" aria-label="Room selection">
            {roomCategories.map((room, index) => (
              <button
                key={room.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                aria-label={`Select ${room.name}`}
                aria-pressed={activeIndex === index}
                className="flex size-6 items-center justify-center rounded-full"
              >
                <span
                  aria-hidden="true"
                  className={`size-2 rounded-full border border-gold transition-colors ${
                    activeIndex === index ? "bg-gold" : "bg-transparent"
                  }`}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
