import { eventHalls, eventsImage } from "@/data/hotel";

export function Events() {
  return (
    <section id="celebrate" className="dark-surface relative overflow-hidden py-28 lg:py-40">
      <div className="absolute inset-0 -z-10">
        <img
          src={eventsImage}
          alt="Banquet hall set for a wedding at Hotel PNS Nakshatra"
          loading="lazy"
          width={1400}
          height={900}
          className="size-full object-cover opacity-55"
          data-parallax="-10"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink/55 via-ink/20 to-transparent" />
      </div>

      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <h2
          className="font-display text-[clamp(3rem,13vw,11rem)] leading-[0.86] text-cream"
          data-reveal
        >
          Celebrate
          <span className="block pl-[8vw] italic text-gold">with</span>
          <span className="block pl-[16vw]">Nakshatra</span>
        </h2>

        <div className="mt-20 grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {eventHalls.map((h) => (
            <div
              key={h.name}
              className="group bg-background/70 p-8 backdrop-blur-sm transition-colors hover:bg-card"
              data-reveal
              data-cursor="View"
            >
              <p className="font-display text-3xl text-cream group-hover:text-gold">{h.name}</p>
              <div className="gold-rule my-5 w-12" />
              <p className="eyebrow">{h.capacity}</p>
              <p className="mt-3 text-sm text-muted-foreground">{h.use}</p>
            </div>
          ))}
        </div>

        <p className="mt-10 max-w-lg text-sm leading-relaxed text-muted-foreground" data-reveal>
          Weddings, receptions, conferences and celebrations — four halls, a dedicated events team
          and catering from our own kitchens.
        </p>
      </div>
    </section>
  );
}
