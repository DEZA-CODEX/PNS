import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useHeroImages } from "@/hooks/useHeroImages";

/**
 * Cinematic hotel backdrop: slow ken-burns crossfade between hotel scenes,
 * with a drifting light sweep and gentle pointer parallax.
 */
export function HeroBackdrop() {
  const slides = useHeroImages("hero_background");
  const root = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || slides.length < 2) {
      return;
    }
    const id = window.setInterval(() => {
      setActive((index) => (index + 1) % slides.length);
    }, 6000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const el = layer.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (e: PointerEvent) => {
      gsap.to(el, {
        x: (e.clientX / window.innerWidth - 0.5) * -34,
        y: (e.clientY / window.innerHeight - 0.5) * -22,
        duration: 1.4,
        ease: "power2.out",
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <div ref={root} className="absolute inset-0 overflow-hidden">
      <div ref={layer} className="absolute -inset-[6%]">
        {slides.map((slide, i) => (
          <img
            key={slide.src}
            src={slide.src}
            alt=""
            loading="eager"
            className={`absolute inset-0 size-full object-cover transition-opacity duration-[2200ms] ease-out ${
              i === active ? "opacity-100 animate-ken-burns" : "opacity-0"
            }`}
          />
        ))}
      </div>

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink/70 via-ink/35 to-ink/10" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/55 via-transparent to-transparent" />
      <div className="pointer-events-none absolute inset-0 animate-light-sweep" />
    </div>
  );
}
