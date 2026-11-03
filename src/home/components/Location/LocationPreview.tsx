import { hotel, nearbyPlaces } from "@/home/data/homeData";
export function LocationPreview() {
  return (
    <section id="vellore" className="mx-auto max-w-[1400px] px-6 py-24 lg:px-12 lg:py-32">
      <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <div data-home-reveal>
          <h2 className="font-display text-[clamp(2.8rem,6vw,5.5rem)] leading-none text-cream">
            Close to what <span className="italic text-gold">matters.</span>
          </h2>
          <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
            {hotel.address}
          </p>
          <a
            href="https://maps.google.com/?q=Hotel+PNS+Nakshatra+Vellore"
            target="_blank"
            rel="noreferrer"
            className="text-link mt-8"
          >
            Get directions
          </a>
        </div>
        <ul>
          {nearbyPlaces.map((place) => (
            <li
              key={place.place}
              className="flex items-baseline justify-between border-b border-border py-5"
              data-home-reveal
            >
              <span className="font-display text-2xl text-cream sm:text-3xl">{place.place}</span>
              <span className="eyebrow">{place.distance}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
