import heroHotel from "@/assets/hero-bg/hero-hotel.jpg";

export function BookingCTA({ onBook: _onBook }: { onBook: () => void }) {
  return (
    <section className="dark-surface relative overflow-hidden border-y border-border px-6 py-32 lg:px-12 lg:py-48">
      <img
        src={heroHotel.src}
        alt="PNS Nakshatra at night"
        className="absolute inset-0 -z-10 size-full object-cover opacity-60"
        loading="lazy"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink/72 via-ink/48 to-ink/25" />
      <div className="mx-auto max-w-[1400px]" data-home-reveal>
        <p className="italic text-gold">PNS Nakshatra</p>
        <h2 className="mt-5 max-w-4xl font-display text-[clamp(3.5rem,10vw,9rem)] leading-[0.82] text-white">
          Experience <span className="italic text-gold">Nakshatra.</span>
        </h2>
        <div className="mt-10 flex flex-wrap gap-6">
          <a href="mailto:stay@pnsnakshatra.com" className="luxury-button-ghost px-9 py-4">
            Contact us
          </a>
        </div>
      </div>
    </section>
  );
}
