import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import heroTitleGraphic from "../../../../Untitled-1.webp";
import { HeroBackdrop } from "@/components/HeroBackdrop";
import { useHeroImages } from "@/hooks/useHeroImages";
import type { BookingDetails } from "@/home/components/Booking/BookingWidget";
import { BookingWidget } from "@/home/components/Booking/BookingWidget";

export function Hero({
  ready = true,
  onBook,
}: {
  ready?: boolean;
  onBook: (details?: BookingDetails) => void;
}) {
  const cardSlides = useHeroImages("hero_container");
  const root = useRef<HTMLElement>(null);
  const image = useRef<HTMLDivElement>(null);
  const [cardIndex, setCardIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || cardSlides.length < 2) {
      return;
    }
    const id = window.setInterval(() => {
      setCardIndex((index) => (index + 1) % cardSlides.length);
    }, 4200);
    return () => window.clearInterval(id);
  }, [cardSlides.length]);

  useEffect(() => {
    if (!ready || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      const lines = root.current?.querySelectorAll("[data-hero-line]");
      const fades = root.current?.querySelectorAll("[data-hero-fade]");
      const heroImage = root.current?.querySelector("[data-hero-image]");
      if (lines?.length) {
        tl.from(lines, { yPercent: 120, opacity: 0, duration: 1.2, stagger: 0.12 });
      }
      if (fades?.length) {
        tl.from(fades, { y: 24, opacity: 0, duration: 0.9, stagger: 0.12 }, 0.7);
      }
      if (heroImage) {
        tl.from(heroImage, { scale: 1.15, opacity: 0, duration: 1.6 }, 0.1);
      }
    }, root);
    return () => ctx.revert();
  }, [ready]);

  useEffect(() => {
    const el = image.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (e: PointerEvent) => {
      const rx = (e.clientY / window.innerHeight - 0.5) * -8;
      const ry = (e.clientX / window.innerWidth - 0.5) * 10;
      gsap.to(el, { rotateX: rx, rotateY: ry, duration: 0.9, ease: "power2.out" });
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <section
      ref={root}
      id="top"
      className="dark-surface relative flex min-h-screen items-center overflow-hidden pb-[clamp(3rem,8vh,7rem)] pt-[clamp(7rem,14vh,10rem)]"
    >
      <div className="absolute inset-0 -z-10">
        <HeroBackdrop />
      </div>

      <div className="mx-auto w-full max-w-[1440px] px-5 lg:px-10">
        <div className="grid grid-cols-1 items-end gap-[clamp(2.5rem,6vw,5rem)] lg:grid-cols-[0.9fr_1.1fr]">
          <div className="relative z-10 pb-4 text-left lg:pb-16">
            <img
              src={heroTitleGraphic.src}
              alt=""
              width={500}
              height={450}
              fetchPriority="high"
              decoding="async"
              className="w-full max-w-[760px] object-contain drop-shadow-[0_14px_30px_rgba(5,14,35,0.24)]"
            />
            <h1 className="sr-only">Where Grandeur meets Grace</h1>
          </div>

          <div className="relative [perspective:1200px]">
            <div
              ref={image}
              data-hero-image
              className="relative overflow-hidden rounded-[1.5rem] border border-cream/20 shadow-[var(--shadow-cinema)] [transform-style:preserve-3d]"
            >
              <div className="relative h-[clamp(24rem,64vh,48rem)] w-full">
                {cardSlides.map((slide, i) => (
                  <img
                    key={slide.src}
                    src={slide.src}
                    alt={slide.alt}
                    width={912}
                    height={1408}
                    loading={i === 0 ? "eager" : "lazy"}
                    fetchPriority={i === 0 ? "high" : "auto"}
                    decoding="async"
                    className={`absolute inset-0 size-full object-cover transition-all duration-[1500ms] ease-out ${i === cardIndex ? "opacity-100 scale-100 [clip-path:inset(0_0_0_0)]" : "opacity-0 scale-110 [clip-path:inset(0_0_0_100%)]"}`}
                  />
                ))}
              </div>
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--hero-overlay)] via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between">
                <p className="font-display text-2xl text-white">Rooms with a point of view</p>
                <p className="eyebrow text-cream">
                  {String(cardIndex + 1).padStart(2, "0")} /{" "}
                  {String(cardSlides.length).padStart(2, "0")}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div data-hero-fade className="mt-8">
          <BookingWidget onBook={onBook} />
        </div>
      </div>
    </section>
  );
}
