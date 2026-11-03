import { useRef, useState } from "react";
import type { PointerEvent } from "react";

export type GuestReview = {
  guest: string;
  rating: number;
  text: string;
  stayType: string;
  location: string;
};

const demoReviews: GuestReview[] = [
  {
    guest: "Sample guest",
    rating: 5,
    text: "Sample review content will be replaced with real guest reviews.",
    stayType: "Demo stay",
    location: "Vellore",
  },
  {
    guest: "Demo traveller",
    rating: 5,
    text: "This is placeholder content for the future verified review feed.",
    stayType: "Demo stay",
    location: "Tamil Nadu",
  },
  {
    guest: "Example guest",
    rating: 4,
    text: "A sample guest story belongs here once the hotel review source is connected.",
    stayType: "Demo stay",
    location: "India",
  },
];

export function Testimonials({ reviews = demoReviews }: { reviews?: GuestReview[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const swipeStart = useRef<number | null>(null);
  const changeBy = (direction: number) => {
    setActiveIndex((current) => (current + direction + reviews.length) % reviews.length);
  };

  return (
    <section className="bg-[var(--color-surface-blue-soft)] px-6 py-24 lg:px-12 lg:py-28">
      <div className="mx-auto grid max-w-[1400px] gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-12">
        <div className="max-w-xl" data-home-reveal>
          <h2 className="font-display text-[clamp(2.5rem,6vw,5rem)] leading-none text-ink">
            Your stay, in <span className="italic text-gold">your words.</span>
          </h2>
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
            Discover what guests have to say about their experience at Hotel PNS Nakshatra.
          </p>
          <p className="mt-3 text-xs uppercase tracking-[0.14em] text-ink/60">
            Sample demo content until verified guest reviews are connected.
          </p>
        </div>

        <div className="lg:pl-2">
          <div
            className="review-carousel"
            role="region"
            aria-roledescription="carousel"
            tabIndex={0}
            aria-label="Guest review carousel"
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") changeBy(1);
              if (event.key === "ArrowLeft") changeBy(-1);
            }}
            onPointerDown={(event) => {
              if (event.pointerType === "touch") swipeStart.current = event.clientX;
            }}
            onPointerUp={(event) => {
              if (swipeStart.current === null) return;
              const distance = event.clientX - swipeStart.current;
              swipeStart.current = null;
              if (Math.abs(distance) > 40) changeBy(distance < 0 ? 1 : -1);
            }}
          >
            {reviews.map((review, index) => {
              const offset = (index - activeIndex + reviews.length) % reviews.length;
              return (
                <article
                  key={`${review.guest}-${index}`}
                  className="review-card"
                  role="button"
                  tabIndex={0}
                  aria-label={`Show review by ${review.guest}`}
                  aria-pressed={index === activeIndex}
                  data-active={index === activeIndex}
                  style={{ "--review-offset": offset } as React.CSSProperties}
                  onClick={() => setActiveIndex(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setActiveIndex(index);
                    }
                  }}
                  onPointerMove={(event: PointerEvent<HTMLElement>) => {
                    if (index !== activeIndex || event.pointerType !== "mouse") return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    event.currentTarget.style.setProperty(
                      "--review-rotate-y",
                      `${((event.clientX - rect.left) / rect.width - 0.5) * 5}deg`,
                    );
                    event.currentTarget.style.setProperty(
                      "--review-rotate-x",
                      `${((event.clientY - rect.top) / rect.height - 0.5) * -4}deg`,
                    );
                  }}
                  onPointerLeave={(event) => {
                    event.currentTarget.style.setProperty("--review-rotate-x", "0deg");
                    event.currentTarget.style.setProperty("--review-rotate-y", "0deg");
                  }}
                >
                  <span className="font-display text-6xl leading-none text-gold">“</span>
                  <p className="mt-3 font-display text-[clamp(1.5rem,2vw,2.5rem)] leading-tight text-ink">
                    {review.text}
                  </p>
                  <div className="mt-8 flex items-end justify-between gap-4 border-t border-gold/30 pt-4">
                    <div>
                      <p className="eyebrow text-ink">{review.guest}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {review.stayType} · {review.location}
                      </p>
                    </div>
                    <span
                      role="img"
                      className="text-sm tracking-[0.18em] text-ink"
                      aria-label={`${review.rating} out of 5 stars`}
                    >
                      {"★".repeat(review.rating)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous review"
                onClick={() => changeBy(-1)}
                className="luxury-button-ghost min-h-11 min-w-11 border-gold bg-[var(--color-navy)] px-4 py-2 text-xs uppercase tracking-[0.14em] text-[var(--color-ivory)] hover:bg-[var(--color-navy-soft)]"
              >
                Previous
              </button>
              <button
                type="button"
                aria-label="Next review"
                onClick={() => changeBy(1)}
                className="luxury-button min-h-11 min-w-11 px-4 py-2 text-xs uppercase tracking-[0.14em]"
              >
                Next
              </button>
            </div>
            <div className="eyebrow text-ink/70 text-[0.62rem]">
              {String(activeIndex + 1).padStart(2, "0")} / {String(reviews.length).padStart(2, "0")}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
