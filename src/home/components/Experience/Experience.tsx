import roomSuite from "@/assets/room-suite.jpg";

const moments = ["Arrival", "Stay", "Dining", "Celebration", "Departure"];
export function Experience() {
  return (
    <section className="relative overflow-hidden bg-background py-24 lg:py-32">
      <img
        src={roomSuite.src}
        alt=""
        aria-hidden="true"
        width={1200}
        height={800}
        loading="lazy"
        className="pointer-events-none absolute right-0 top-12 z-0 hidden h-[26rem] w-[32%] max-w-[420px] object-cover opacity-20 md:block"
      />
      <div className="relative z-10 mx-auto max-w-[1400px] px-6 lg:px-12">
        <div className="relative">
          <div className="relative z-10 max-w-[76rem] lg:pr-[26%]">
            <h2
              className="max-w-5xl font-display text-[clamp(3.4rem,10vw,9rem)] leading-[0.82] text-cream"
              data-home-reveal
            >
              Make room for <span className="italic text-gold">the moment.</span>
            </h2>
            <div className="mt-8 h-px w-full max-w-[36rem] bg-gradient-to-r from-gold via-gold/80 to-transparent" />
          </div>
        </div>
        <div className="mt-12 grid grid-cols-2 gap-y-8 border-t border-gold/40 pt-8 sm:grid-cols-5">
          {moments.map((moment) => (
            <div key={moment} data-home-reveal>
              <p className="font-display text-2xl text-cream">{moment}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
