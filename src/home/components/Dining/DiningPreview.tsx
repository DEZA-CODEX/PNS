import { useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { dining } from "@/data/hotel";
import { useDiningImageLibrary } from "@/hooks/useDiningImages";
import { diningImageRepository, getSelectedDiningImages } from "@/services/roomImageRepository";
import type { DiningType } from "@/types/roomImages";

const diningTypeByCard: Record<string, DiningType> = {
  cloud9: "cloud9",
  vrindavan: "vrindavan",
  clinq: "clinq",
};

function setPanelTilt(element: HTMLElement, event: PointerEvent<HTMLElement>) {
  if (event.pointerType !== "mouse") return;
  const bounds = element.getBoundingClientRect();
  const rotateX = ((event.clientY - bounds.top) / bounds.height - 0.5) * -3;
  const rotateY = ((event.clientX - bounds.left) / bounds.width - 0.5) * 4;
  element.style.setProperty("--panel-rotate-x", `${rotateX}deg`);
  element.style.setProperty("--panel-rotate-y", `${rotateY}deg`);
}

export function DiningPreview() {
  const { images: diningImages } = useDiningImageLibrary();
  const [activeIndex, setActiveIndex] = useState(0);
  const swipeStart = useRef<number | null>(null);
  const orderedDining = useMemo(
    () => [dining[activeIndex]!, ...dining.filter((_, index) => index !== activeIndex)],
    [activeIndex],
  );
  const changeBy = (direction: number) => {
    setActiveIndex((current) => (current + direction + dining.length) % dining.length);
  };

  return (
    <section id="dine" className="bg-[var(--color-surface-blue)] px-6 py-24 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-[1400px]">
        <h2
          className="max-w-4xl font-display text-[clamp(2.5rem,6vw,5.2rem)] leading-none text-cream"
          data-home-reveal
        >
          Good evenings begin <span className="italic text-gold">here.</span>
        </h2>
        <div
          role="region"
          aria-roledescription="carousel"
          className="editorial-carousel editorial-carousel-dining mt-12 grid gap-4 md:grid-cols-12 md:grid-rows-[minmax(15rem,1fr)_minmax(15rem,1fr)]"
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
          aria-label="Dining showcase"
        >
          {orderedDining.map((item, index) => {
            const originalIndex = dining.findIndex((diningItem) => diningItem.id === item.id);
            const active = index === 0;
            const image = getSelectedDiningImages(
              diningImages,
              "homepage",
              diningTypeByCard[item.id],
            )[0];
            return (
              <article
                key={item.id}
                className={`editorial-carousel-item group relative min-h-[22rem] overflow-hidden border border-gold/40 ${
                  active
                    ? "editorial-carousel-item-active md:col-span-8 md:row-span-2"
                    : "md:col-span-4"
                }`}
                data-active={active}
                data-home-reveal
                onPointerMove={(event) => setPanelTilt(event.currentTarget, event)}
                onPointerLeave={(event) => {
                  event.currentTarget.style.setProperty("--panel-rotate-x", "0deg");
                  event.currentTarget.style.setProperty("--panel-rotate-y", "0deg");
                }}
                onMouseEnter={() => setActiveIndex(originalIndex)}
              >
                <button
                  type="button"
                  onClick={() => setActiveIndex(originalIndex)}
                  onFocus={() => setActiveIndex(originalIndex)}
                  className="absolute inset-0 z-10 cursor-pointer"
                  aria-label={`Show ${item.name}`}
                  aria-pressed={active}
                />
                {image ? (
                  <img
                    src={image.url}
                    alt={image.altText}
                    loading="lazy"
                    width="1400"
                    height="900"
                    onError={() => {
                      if (process.env.NODE_ENV === "development") {
                        console.error(`Dining image ${image.id} failed to load: ${image.url}`);
                      }
                      diningImageRepository.reportUnavailable(image.id);
                    }}
                    className="size-full min-h-[22rem] object-cover transition-transform duration-[1200ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04] md:min-h-0"
                  />
                ) : null}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/15 to-transparent" />
                <div className="pointer-events-none absolute inset-x-6 bottom-6 z-20 md:inset-x-8 md:bottom-8">
                  <p className="eyebrow text-gold">{item.tag}</p>
                  <h3
                    className={`mt-2 font-display leading-none text-[var(--color-ivory)] ${
                      active ? "text-5xl md:text-7xl" : "text-4xl"
                    }`}
                  >
                    {item.name}
                  </h3>
                  <div
                    className={`overflow-hidden transition-[max-height,opacity,transform] duration-700 ${
                      active
                        ? "mt-4 max-h-36 translate-y-0 opacity-100"
                        : "max-h-0 translate-y-3 opacity-0"
                    }`}
                  >
                    <p className="font-display text-2xl italic text-gold">{item.line}</p>
                    <p className="editorial-panel-copy mt-3 max-w-xl text-sm leading-relaxed">
                      {item.detail}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <div className="mt-8 flex items-center justify-between border-t border-gold/40 pt-4">
          <p className="eyebrow">Explore dining · {dining[activeIndex]?.tag}</p>
          <div role="group" className="flex gap-1" aria-label="Dining selection">
            {dining.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                aria-label={`Select ${item.name}`}
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
        <a href="#dine" className="text-link mt-10">
          Explore dining
        </a>
      </div>
    </section>
  );
}
