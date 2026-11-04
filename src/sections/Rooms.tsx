import { useState } from "react";
import { rooms } from "@/data/hotel";

export function Rooms() {
  const [active, setActive] = useState(0);
  const room = rooms[active]!;

  return (
    <section id="stay" className="relative mx-auto max-w-[1400px] px-6 py-28 lg:px-12 lg:py-40">
      <h2
        className="max-w-3xl font-display text-[clamp(2.2rem,5.5vw,4.5rem)] leading-tight text-cream"
        data-reveal
      >
        Premium rooms at <span className="italic text-gold">PNS Nakshatra</span>
      </h2>

      <div className="mt-16 grid grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <ul className="order-2 flex flex-col lg:order-1" data-reveal>
          {rooms.map((r, i) => (
            <li key={r.id}>
              <button
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => setActive(i)}
                data-cursor="View"
                className={`group flex w-full items-baseline justify-between border-b border-border py-7 text-left transition-colors ${
                  active === i ? "text-gold" : "text-cream hover:text-gold"
                }`}
              >
                <span className="font-display text-3xl sm:text-4xl">{r.name}</span>
                <span className="eyebrow">{r.size}</span>
              </button>
              {active === i ? (
                <div className="pb-8 pt-5">
                  <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                    {r.detail}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
                    {r.amenities.map((a) => (
                      <span key={a} className="eyebrow">
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="order-1 lg:order-2" data-reveal>
          <div className="relative overflow-hidden rounded-[1.5rem] border border-border shadow-[var(--shadow-cinema)]">
            {rooms.map((r, i) => (
              <img
                key={r.id}
                src={r.image}
                alt={`${r.name} at Hotel PNS Nakshatra Vellore`}
                loading="lazy"
                width={1200}
                height={800}
                className={`h-[46vh] w-full object-cover transition-all duration-[1200ms] ease-out lg:h-[62vh] ${
                  active === i ? "opacity-100 scale-100" : "absolute inset-0 opacity-0 scale-105"
                }`}
              />
            ))}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-transparent" />
            <p className="absolute bottom-6 left-6 font-display text-2xl text-cream">{room.name}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
