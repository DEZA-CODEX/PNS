"use client";

import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUpRight, CalendarDays, Cake, Heart, Sparkles, Users } from "lucide-react";
import gsap from "gsap";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/sections/Footer";
import { useReveal } from "@/hooks/useReveal";
import eventsBanquet from "@/assets/events-banquet.jpg";

const halls = [
  {
    name: "Tamara",
    number: "01",
    description:
      "An elegant setting for memorable celebrations, special occasions, and gatherings with the people who matter most.",
    position: "center",
  },
  {
    name: "Tavisha",
    number: "02",
    description:
      "A welcoming venue designed to bring family, friends, and colleagues together for meaningful occasions and celebrations.",
    position: "60% center",
  },
  {
    name: "Titiksha",
    number: "03",
    description:
      "A versatile space for private functions, social gatherings, and professional events, thoughtfully arranged around your occasion.",
    position: "38% center",
  },
];

const eventTypes = [
  [Heart, "Weddings & receptions"],
  [Sparkles, "Engagements & anniversaries"],
  [Cake, "Birthday celebrations"],
  [Users, "Family & private functions"],
  [CalendarDays, "Corporate meetings"],
  [ArrowUpRight, "Business events & launches"],
] as const;

export function Banquet() {
  const root = useRef<HTMLElement>(null);
  const openEventEnquiry = () => {
    window.location.assign("/contact?enquiry=event");
  };
  useReveal(true);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        "[data-banquet-hero]",
        { y: 24, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 1.2, stagger: 0.08, ease: "power3.out" },
      );
    }, root);
    return () => context.revert();
  }, []);

  return (
    <div className="readable-content min-h-screen bg-background text-foreground">
      <Navbar onBook={openEventEnquiry} />
      <main ref={root}>
        <section className="relative isolate flex min-h-[min(850px,100svh)] items-end overflow-hidden bg-[#051838] px-6 pb-16 pt-36 lg:px-12 lg:pb-24 lg:pt-48">
          <img
            src={eventsBanquet.src}
            alt="Elegant banquet hall prepared for a celebration at Hotel PNS Nakshatra"
            width={1600}
            height={1000}
            fetchPriority="high"
            className="absolute inset-0 -z-20 size-full object-cover object-center"
          />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(3,16,39,.9),rgba(3,16,39,.48),rgba(3,16,39,.25)),linear-gradient(0deg,rgba(3,16,39,.82),transparent_55%)]" />
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_75%_25%,rgba(205,169,92,.22),transparent_30%)]" />
          <div className="mx-auto w-full max-w-[1400px]">
            <div className="max-w-4xl">
              <p className="eyebrow text-gold" data-banquet-hero>
                Banquet &amp; Events / PNS Nakshatra
              </p>
              <h1
                className="hero-headline mt-6 max-w-4xl text-[clamp(3.8rem,9vw,9rem)] leading-[0.84] text-[var(--color-ivory)]"
                data-banquet-hero
              >
                Celebrate Every <span className="block pl-[8vw] italic text-gold">Moment</span> in
                Elegance
              </h1>
              <p
                className="mt-8 max-w-xl text-base leading-relaxed text-[var(--color-ivory)]/82 sm:text-lg"
                data-banquet-hero
              >
                Discover the perfect setting for weddings, receptions, corporate gatherings, and
                unforgettable celebrations at Hotel PNS Nakshatra.
              </p>
              <div className="mt-9 flex flex-wrap gap-4" data-banquet-hero>
                <a
                  href="/contact?enquiry=event"
                  className="luxury-button luxury-button-hover px-6 py-3"
                >
                  Enquire About Your Event
                </a>
                <a
                  href="#halls"
                  className="luxury-button-ghost px-6 py-3 text-[var(--color-ivory)]"
                >
                  Explore Our Halls
                </a>
              </div>
            </div>
            <a
              href="#intro"
              className="mt-16 inline-flex items-center gap-3 text-[var(--color-ivory)]/75 transition-colors hover:text-gold"
              data-banquet-hero
            >
              <span className="eyebrow text-[0.62rem] text-inherit">Scroll to explore</span>
              <ArrowDown className="size-4 animate-bounce" aria-hidden="true" />
            </a>
          </div>
        </section>

        <section id="intro" className="bg-[var(--color-surface-cool)] px-6 py-24 lg:px-12 lg:py-36">
          <div className="mx-auto grid max-w-[1400px] items-center gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-24">
            <div className="relative" data-reveal>
              <div
                className="absolute -inset-4 border border-gold/30 lg:-inset-7"
                aria-hidden="true"
              />
              <img
                src={eventsBanquet.src}
                alt="Warmly lit event space at Hotel PNS Nakshatra"
                width={1200}
                height={900}
                loading="lazy"
                className="relative aspect-[4/3] w-full object-cover"
                data-parallax="-5"
              />
              <p className="absolute bottom-4 left-4 bg-[#051838]/85 px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--color-ivory)]">
                Gather beautifully
              </p>
            </div>
            <div data-reveal>
              <p className="eyebrow text-gold">01 — The occasion</p>
              <h2 className="mt-5 max-w-2xl font-display text-[clamp(3rem,7vw,6rem)] leading-[0.88] text-ink">
                Meetings <span className="italic text-gold">&amp;</span> Events
              </h2>
              <p className="mt-3 font-display text-2xl text-ink/65">
                Have lots of fun in our place
              </p>
              <div className="gold-rule mt-8 w-20" />
              <p className="mt-8 max-w-xl text-base leading-relaxed text-ink/75">
                Turn your special moments into lasting memories at Hotel PNS Nakshatra. From elegant
                celebrations and family gatherings to corporate meetings and private events,
                discover a welcoming venue designed to bring people together. Our team can help you
                plan the details, personalize your event, and create an experience that feels
                uniquely yours.
              </p>
              <a href="#halls" className="text-link mt-8 inline-flex items-center gap-2">
                Discover the spaces <ArrowDown className="size-4" />
              </a>
            </div>
          </div>
        </section>

        <section id="halls" className="dark-surface bg-[#051838] px-6 py-24 lg:px-12 lg:py-36">
          <div className="mx-auto max-w-[1400px]">
            <div
              className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end"
              data-reveal
            >
              <div>
                <p className="eyebrow text-gold">02 — Find your setting</p>
                <h2 className="mt-5 max-w-3xl font-display text-[clamp(3rem,7vw,7rem)] leading-[0.84] text-[var(--color-ivory)]">
                  Explore our <span className="italic text-gold">three</span> halls
                </h2>
              </div>
              <p className="max-w-sm text-sm leading-relaxed text-[var(--color-ivory)]/70">
                Every gathering has its own rhythm. Explore a space that lets your occasion take
                centre stage.
              </p>
            </div>
            <div className="mt-14 grid gap-5 lg:grid-cols-3">
              {halls.map((hall) => (
                <article
                  key={hall.name}
                  className="group overflow-hidden border border-gold/20 bg-[#0a2448] transition-transform duration-700 [transform:perspective(1200px)_rotateX(0deg)] hover:-translate-y-2 hover:[transform:perspective(1200px)_rotateX(2deg)]"
                  data-reveal
                >
                  <div className="relative aspect-[4/3] overflow-hidden">
                    <img
                      src={eventsBanquet.src}
                      alt={`${hall.name} banquet hall setting`}
                      width={1200}
                      height={900}
                      loading="lazy"
                      className="size-full object-cover transition duration-1000 group-hover:scale-105"
                      style={{ objectPosition: hall.position }}
                    />
                    <span className="absolute left-5 top-5 font-display text-4xl text-[var(--color-ivory)]/85">
                      {hall.number}
                    </span>
                    <div className="absolute inset-0 bg-gradient-to-t from-[#051838] via-transparent to-transparent opacity-80" />
                  </div>
                  <div className="p-7 sm:p-8">
                    <h3 className="font-display text-4xl text-[var(--color-ivory)] transition-colors group-hover:text-gold">
                      {hall.name}
                    </h3>
                    <div className="gold-rule my-5 w-12" />
                    <p className="min-h-20 text-sm leading-relaxed text-[var(--color-ivory)]/72">
                      {hall.description}
                    </p>
                    <a
                      href={`/contact?hall=${hall.name}`}
                      className="mt-7 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-gold transition-colors hover:text-[var(--color-ivory)]"
                    >
                      Enquire about this hall <ArrowUpRight className="size-4" />
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-background px-6 py-24 lg:px-12 lg:py-32">
          <div className="mx-auto max-w-[1400px]">
            <div data-reveal>
              <p className="eyebrow text-gold">03 — Bring people together</p>
              <h2 className="mt-5 max-w-3xl font-display text-[clamp(3rem,7vw,7rem)] leading-[0.84] text-ink">
                Events we <span className="italic text-gold">welcome</span>
              </h2>
            </div>
            <div className="mt-14 grid grid-cols-1 border-l border-t border-gold/30 sm:grid-cols-2 lg:grid-cols-3">
              {eventTypes.map(([Icon, label]) => (
                <div
                  key={label}
                  className="group flex min-h-40 flex-col justify-between border-b border-r border-gold/30 p-7 transition-colors hover:bg-[var(--color-surface-cool)] sm:p-9"
                  data-reveal
                >
                  <Icon
                    className="size-6 text-gold transition-transform duration-500 group-hover:scale-110"
                    aria-hidden="true"
                  />
                  <p className="mt-8 max-w-48 font-display text-2xl leading-tight text-ink">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="dark-surface overflow-hidden bg-[#0a2448] px-6 py-24 lg:px-12 lg:py-36">
          <div className="mx-auto grid max-w-[1400px] items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-24">
            <div data-reveal>
              <p className="eyebrow text-gold">04 — Thoughtfully yours</p>
              <h2 className="mt-5 max-w-2xl font-display text-[clamp(3rem,7vw,6.5rem)] leading-[0.86] text-[var(--color-ivory)]">
                Your occasion. <span className="italic text-gold">Your vision.</span> Our
                hospitality.
              </h2>
              <div className="gold-rule mt-8 w-20" />
              <p className="mt-8 max-w-xl text-base leading-relaxed text-[var(--color-ivory)]/75">
                Every occasion deserves thoughtful planning. Connect with our team to discuss your
                preferred hall, event arrangements, and special requirements. We will help you
                explore the available options and plan your gathering around your needs.
              </p>
              <a
                href="/contact?enquiry=event"
                className="luxury-button luxury-button-hover mt-9 inline-flex px-6 py-3"
              >
                Talk to our team <ArrowUpRight className="ml-2 size-4" />
              </a>
            </div>
            <div className="relative" data-reveal>
              <div className="absolute -inset-5 border border-gold/25" aria-hidden="true" />
              <img
                src={eventsBanquet.src}
                alt="Details of the banquet hall interior"
                width={1200}
                height={900}
                loading="lazy"
                className="relative aspect-[4/5] w-full object-cover"
                data-parallax="-7"
              />
            </div>
          </div>
        </section>

        <section className="bg-[var(--color-surface-cool)] px-6 py-24 lg:px-12 lg:py-32">
          <div className="mx-auto max-w-[1400px]">
            <div
              className="flex flex-col justify-between gap-6 border-b border-gold/30 pb-8 sm:flex-row sm:items-end"
              data-reveal
            >
              <div>
                <p className="eyebrow text-gold">05 — A glimpse of the atmosphere</p>
                <h2 className="mt-5 font-display text-[clamp(3rem,7vw,6rem)] leading-[0.86] text-ink">
                  Gather <span className="italic text-gold">here.</span>
                </h2>
              </div>
              <p className="max-w-xs text-sm leading-relaxed text-ink/65">
                Banquet imagery will grow with the spaces and stories we share here.
              </p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-[1.35fr_0.65fr]" data-reveal>
              <button
                type="button"
                className="group relative aspect-[16/9] overflow-hidden text-left"
                aria-label="Open banquet hall image"
              >
                <img
                  src={eventsBanquet.src}
                  alt="Banquet hall interior at Hotel PNS Nakshatra"
                  width={1400}
                  height={900}
                  loading="lazy"
                  className="size-full object-cover transition duration-700 group-hover:scale-105"
                />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#051838]/85 to-transparent px-6 pb-5 pt-16 text-sm text-[var(--color-ivory)]">
                  The evening begins here
                </span>
              </button>
              <div className="flex aspect-[16/9] min-h-48 items-center justify-center border border-dashed border-gold/45 bg-background p-8 text-center md:aspect-auto">
                <div>
                  <Sparkles className="mx-auto size-7 text-gold" aria-hidden="true" />
                  <p className="mt-4 font-display text-2xl text-ink">More moments to come</p>
                  <p className="mt-2 text-sm text-ink/60">
                    New banquet images can be added through the hotel’s managed image workflow.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="enquire"
          className="relative isolate overflow-hidden bg-[#051838] px-6 py-24 text-center lg:px-12 lg:py-36"
        >
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_center,rgba(205,169,92,.2),transparent_48%)]" />
          <div className="mx-auto max-w-4xl" data-reveal>
            <p className="eyebrow text-gold">06 — Begin the conversation</p>
            <h2 className="mt-6 font-display text-[clamp(3.2rem,8vw,8rem)] leading-[0.86] text-[var(--color-ivory)]">
              Let&apos;s plan your next <span className="italic text-gold">celebration</span>
            </h2>
            <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-[var(--color-ivory)]/75">
              Tell us about your occasion, preferred date, expected guests, and the hall you would
              like to explore.
            </p>
            <a
              href="/contact?enquiry=event"
              className="luxury-button luxury-button-hover mt-9 inline-flex px-7 py-3.5"
            >
              Contact us about your event <ArrowUpRight className="ml-2 size-4" />
            </a>
          </div>
        </section>
      </main>
      <Footer onBook={openEventEnquiry} />
    </div>
  );
}
