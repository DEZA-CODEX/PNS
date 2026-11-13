import heroHotel from "@/assets/hero-bg/hero-hotel.jpg";
import { hotel } from "@/home/data/homeData";
export function AboutPreview() {
  return (
    <section
      id="about"
      className="mx-auto grid max-w-[1400px] grid-cols-1 gap-12 px-6 py-24 lg:grid-cols-[0.8fr_1.2fr] lg:grid-rows-[auto_auto] lg:gap-y-8 lg:px-12 lg:py-32"
    >
      <div data-home-reveal className="lg:row-start-1 lg:self-center">
        <h2 className="font-display text-left text-[clamp(2.6rem,6vw,5.5rem)] leading-none text-cream">
          Considered stay in<span className="italic text-gold">Vellore.</span>
        </h2>
      </div>
      <div data-home-reveal className="lg:col-start-2 lg:row-start-1 lg:w-[130%]">
        <div className="overflow-hidden border border-border">
          <img
            src={heroHotel.src}
            alt="Hotel PNS Nakshatra at night"
            loading="lazy"
            className="aspect-[4/3] w-full object-cover lg:aspect-[40/27]"
          />
        </div>
      </div>
      <div data-home-reveal className="lg:col-start-2 lg:row-start-2">
        <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
          {hotel.description} Every detail is designed to make arrival feel easy and the time after
          it feel entirely your own.
        </p>
        <a href="#about" className="text-link mt-8">
          Explore our story
        </a>
      </div>
    </section>
  );
}
