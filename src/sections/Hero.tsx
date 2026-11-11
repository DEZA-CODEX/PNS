import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { HeroBackdrop } from "@/components/HeroBackdrop";
import { useHeroImages } from "@/hooks/useHeroImages";

export function Hero({ ready, onBook }: { ready: boolean; onBook: () => void }) {
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
      tl.from("[data-hero-line]", { yPercent: 120, opacity: 0, duration: 1.2, stagger: 0.12 })
        .from("[data-hero-preview]", { scale: 0.8, opacity: 0, duration: 0.9, stagger: 0.1 }, 0.3)
        .from("[data-hero-fade]", { y: 24, opacity: 0, duration: 0.9, stagger: 0.12 }, 0.7)
        .from("[data-hero-image]", { scale: 1.15, opacity: 0, duration: 1.6 }, 0.1);
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
      className="dark-surface relative flex min-h-screen items-center overflow-hidden pb-20 pt-32"
    >
      <div className="absolute inset-0 -z-10">
        <HeroBackdrop />
      </div>

      <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 items-center gap-14 px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-12">
        <div>
          <div className="flex gap-3">
            {cardSlides.map((slide, i) => (
              <button
                key={slide.src}
                type="button"
                onClick={() => setCardIndex(i)}
                data-hero-preview
                aria-label={`Show ${slide.alt}`}
                aria-pressed={i === cardIndex}
                className={`h-16 w-20 overflow-hidden rounded-sm border transition-all duration-500 sm:h-20 sm:w-28 ${
                  i === cardIndex
                    ? "border-gold opacity-100"
                    : "border-border opacity-60 hover:opacity-90"
                }`}
              >
                <img
                  src={slide.src}
                  alt={slide.alt}
                  loading="lazy"
                  width={1200}
                  height={800}
                  className="size-full object-cover"
                />
              </button>
            ))}
          </div>

          <h1 className="mt-8 font-display text-[clamp(2.8rem,8vw,6.2rem)] leading-[0.95] text-cream">
            <span className="block overflow-hidden">
              <span data-hero-line className="block">
                Where comfort
              </span>
            </span>
            <span className="block overflow-hidden">
              <span data-hero-line className="block italic text-gold">
                meets elegance
              </span>
            </span>
          </h1>

          <p data-hero-fade className="eyebrow mt-6">
            PNS Nakshatra · Vellore
          </p>
          <p data-hero-fade className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
            A contemporary hotel in the heart of Vellore — rooms designed for rest, a rooftop that
            watches over the city, and celebration halls made for the days you remember.
          </p>

          <div data-hero-fade className="mt-10 flex flex-wrap items-center gap-8">
            <button
              onClick={onBook}
              data-cursor="Book"
              className="luxury-button luxury-button-hover px-10 py-4"
            >
              Book your stay
            </button>
            <a href="#stay" className="eyebrow hover:text-gold">
              Scroll ↓
            </a>
          </div>
        </div>

        <div className="[perspective:1200px]">
          <div
            ref={image}
            data-hero-image
            className="relative overflow-hidden rounded-[2rem] border border-border shadow-[var(--shadow-cinema)] [transform-style:preserve-3d]"
          >
            <div className="relative h-[58vh] w-full lg:h-[78vh]">
              {cardSlides.map((slide, i) => (
                <img
                  key={slide.src}
                  src={slide.src}
                  alt={slide.alt}
                  width={912}
                  height={1408}
                  loading={i === 0 ? "eager" : "lazy"}
                  fetchPriority={i === 0 ? "high" : "auto"}
                  className={`absolute inset-0 size-full object-cover transition-all duration-[1500ms] ease-out ${
                    i === cardIndex
                      ? "opacity-100 scale-100 [clip-path:inset(0_0_0_0)]"
                      : "opacity-0 scale-110 [clip-path:inset(0_0_0_100%)]"
                  }`}
                />
              ))}
            </div>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
            <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between">
              <p className="font-display text-2xl text-cream">Est. Vellore</p>
              <p className="eyebrow">3★ Comfort</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
