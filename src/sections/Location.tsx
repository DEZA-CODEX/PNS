import { nearby } from "@/data/hotel";

export function Location() {
  return (
    <section id="vellore" className="mx-auto max-w-[1400px] px-6 py-28 lg:px-12 lg:py-40">
      <div className="grid grid-cols-1 gap-16 lg:grid-cols-2">
        <div>
          <h2
            className="font-display text-[clamp(2.2rem,5.5vw,4.5rem)] leading-tight text-cream"
            data-reveal
          >
            Discover <span className="italic text-gold">Vellore</span>
          </h2>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground" data-reveal>
            Minutes from CMC and the city centre, within easy reach of VIT, the Fort and the Golden
            Temple at Sripuram — a base for treatment, study, business or a weekend away.
          </p>
        </div>

        <ul className="flex flex-col">
          {nearby.map((n) => (
            <li
              key={n.place}
              className="group flex items-baseline justify-between border-b border-border py-6"
              data-reveal
            >
              <span className="font-display text-2xl text-cream transition-colors group-hover:text-gold sm:text-3xl">
                {n.place}
              </span>
              <span className="eyebrow">{n.distance}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
