import { dining } from "@/data/hotel";
import { useDiningImageLibrary } from "@/hooks/useDiningImages";
import { getSelectedDiningImages } from "@/services/roomImageRepository";
import type { DiningType } from "@/types/roomImages";

const diningTypeByCard: Record<string, DiningType> = {
  cloud9: "cloud9",
  vrindavan: "vrindavan",
  clinq: "clinq",
};

export function Dining() {
  const { images: diningImages } = useDiningImageLibrary();
  return (
    <section id="dine" className="relative py-28 lg:py-40">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <h2
          className="max-w-3xl font-display text-[clamp(2.2rem,5.5vw,4.5rem)] leading-tight text-cream"
          data-reveal
        >
          Rooftop dining, tradition and <span className="italic text-gold">late nights</span>
        </h2>
      </div>

      <div className="mt-20 flex flex-col gap-24 lg:gap-36">
        {dining.map((d, i) =>
          (() => {
            const image = getSelectedDiningImages(
              diningImages,
              "diningPage",
              diningTypeByCard[d.id],
            )[0];
            if (!image) return null;
            return (
              <article
                key={d.id}
                className={`mx-auto grid w-full max-w-[1400px] grid-cols-1 items-center gap-10 px-6 lg:grid-cols-2 lg:px-12 ${
                  i % 2 ? "lg:[&>*:first-child]:order-2" : ""
                }`}
              >
                <div
                  className="relative overflow-hidden rounded-[1.5rem] border border-border shadow-[var(--shadow-cinema)]"
                  data-reveal
                  data-cursor="View"
                >
                  <img
                    src={image.url}
                    alt={image.altText}
                    loading="lazy"
                    width={1400}
                    height={900}
                    className="h-[44vh] w-full object-cover transition-transform duration-[1400ms] ease-out hover:scale-105 lg:h-[64vh]"
                    data-parallax="-6"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/65 via-ink/10 to-transparent" />
                </div>

                <div className="lg:px-10" data-reveal data-reveal-delay="0.1">
                  <p className="eyebrow">{d.tag}</p>
                  <h3 className="mt-4 font-display text-[clamp(2.4rem,6vw,5rem)] leading-none text-cream">
                    {d.name}
                  </h3>
                  <p className="mt-5 font-display text-2xl italic text-gold">{d.line}</p>
                  <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">
                    {d.detail}
                  </p>
                  <span className="eyebrow mt-8 inline-block border-b border-gold/60 pb-1 text-gold">
                    Explore →
                  </span>
                </div>
              </article>
            );
          })(),
        )}
      </div>
    </section>
  );
}
