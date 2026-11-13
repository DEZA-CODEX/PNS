"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Phone } from "lucide-react";
import { BookingPanel } from "@/components/BookingPanel";
import { Cursor } from "@/components/Cursor";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/sections/Footer";
import type { BookingDetails } from "@/home/components/Booking/BookingWidget";
import { diningExperiences, type DiningExperience } from "@/data/dining";
import { useDiningImageLibrary } from "@/hooks/useDiningImages";
import { diningImageRepository, getSelectedDiningImages } from "@/services/roomImageRepository";
import type { DiningImage } from "@/types/roomImages";

function SpatialGallery({
  experience,
  images,
}: {
  experience: DiningExperience;
  images: DiningImage[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || !root.current) return;
    const bounds = root.current.getBoundingClientRect();
    const rotateX = ((event.clientY - bounds.top) / bounds.height - 0.5) * -4;
    const rotateY = ((event.clientX - bounds.left) / bounds.width - 0.5) * 5;
    root.current.style.setProperty("--dining-rotate-x", `${rotateX}deg`);
    root.current.style.setProperty("--dining-rotate-y", `${rotateY}deg`);
  };

  return (
    <div
      ref={root}
      className={`dining-spatial-gallery dining-spatial-gallery-${experience.tone} dining-spatial-gallery-count-${images.length}`}
      onPointerMove={onMove}
      onPointerLeave={() => {
        root.current?.style.setProperty("--dining-rotate-x", "0deg");
        root.current?.style.setProperty("--dining-rotate-y", "0deg");
      }}
    >
      <div className="dining-spatial-backdrop" />
      {images.length === 0 ? (
        <div className="dining-image-empty" role="status">
          Dining image temporarily unavailable
        </div>
      ) : null}
      {images.map((image, index) =>
        failedImages.has(image.id) ? (
          process.env.NODE_ENV === "development" ? (
            <div
              key={image.id}
              className={`dining-spatial-image dining-spatial-image-${index} dining-image-error`}
            >
              Image unavailable
            </div>
          ) : null
        ) : (
          <img
            key={image.id}
            src={image.url}
            alt={image.altText}
            loading={index === 0 ? "eager" : "lazy"}
            width="1200"
            height="900"
            onError={() => {
              if (process.env.NODE_ENV === "development")
                console.error(`Dining image ${image.id} failed to load: ${image.url}`);
              diningImageRepository.reportUnavailable(image.id);
              setFailedImages((current) => new Set(current).add(image.id));
            }}
            className={`dining-spatial-image dining-spatial-image-${index}`}
          />
        ),
      )}
      <span className="dining-spatial-index">
        0{diningExperiences.findIndex((item) => item.id === experience.id) + 1} / 03
      </span>
    </div>
  );
}

function ExperienceSection({
  experience,
  images,
  index,
  onBook,
}: {
  experience: DiningExperience;
  images: DiningImage[];
  index: number;
  onBook: () => void;
}) {
  const lightSurface = index === 1;
  return (
    <section
      id={experience.id}
      className={`dining-experience dining-experience-${experience.tone} ${lightSurface ? "dining-experience-light" : ""} relative overflow-hidden px-6 py-24 lg:px-12 lg:py-36`}
    >
      <div className="mx-auto grid max-w-[1400px] items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
        <div className={index % 2 ? "lg:order-2" : ""}>
          <p className="eyebrow text-gold">
            0{index + 1} — {experience.category}
          </p>
          <h2
            className={`mt-5 max-w-3xl font-display text-[clamp(3rem,7vw,7rem)] leading-[0.84] ${lightSurface ? "text-ink" : "text-[var(--color-ivory)]"}`}
          >
            {experience.name}
          </h2>
          <h3 className="mt-6 max-w-2xl font-display text-3xl leading-none text-gold lg:text-4xl">
            {experience.heading}
          </h3>
          <p
            className={`mt-7 max-w-xl text-base leading-relaxed ${lightSurface ? "text-ink/85" : "text-[var(--color-ivory)]/85"}`}
          >
            {experience.description}
          </p>
          <ul
            className={`mt-7 grid max-w-xl gap-3 border-y border-gold/30 py-5 text-sm sm:grid-cols-2 ${lightSurface ? "text-ink/85" : "text-[var(--color-ivory)]/85"}`}
          >
            {experience.features.map((feature) => (
              <li key={feature} className="border-l border-gold/50 pl-3">
                {feature}
              </li>
            ))}
          </ul>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            {experience.menuLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={`luxury-button-ghost px-5 py-3 ${lightSurface ? "text-ink" : "editorial-panel-button"}`}
              >
                {link.label}
              </a>
            ))}
            <a
              href={experience.phoneHref}
              className="luxury-button luxury-button-hover inline-flex items-center gap-2 px-5 py-3"
            >
              <Phone className="size-4" />
              Call {experience.name}
            </a>
            <button
              onClick={onBook}
              className={`text-link ${lightSurface ? "text-ink" : "text-[var(--color-ivory)]"}`}
            >
              Reserve now <ArrowUpRight className="ml-2 size-4" />
            </button>
          </div>
          <p
            className={`eyebrow mt-5 ${lightSurface ? "text-ink/70" : "text-[var(--color-ivory)]/70"}`}
          >
            {experience.phone}
          </p>
        </div>
        <div className={index % 2 ? "lg:order-1" : ""}>
          <SpatialGallery experience={experience} images={images} />
        </div>
      </div>
    </section>
  );
}

export function Dining() {
  const [booking, setBooking] = useState(false);
  const [selectedId, setSelectedId] = useState(diningExperiences[0]!.id);
  const { images: diningImageLibrary, displayCounts } = useDiningImageLibrary();
  const [bookingDetails, setBookingDetails] = useState<BookingDetails>({
    destination: "",
    checkIn: "",
    checkOut: "",
    adults: 2,
    children: 0,
    rooms: 1,
    travelingForWork: false,
    travelingWithPets: false,
  });
  const openBooking = (details?: BookingDetails) => {
    if (details) setBookingDetails(details);
    setBooking(true);
  };

  useEffect(() => {
    const updateSelected = () => {
      const visible = diningExperiences
        .map((experience) => ({
          id: experience.id,
          top: Math.abs(
            document.getElementById(experience.id)?.getBoundingClientRect().top ?? Infinity,
          ),
        }))
        .sort((a, b) => a.top - b.top)[0];
      if (visible) setSelectedId(visible.id);
    };
    window.addEventListener("scroll", updateSelected, { passive: true });
    return () => window.removeEventListener("scroll", updateSelected);
  }, []);

  return (
    <div className="readable-content min-h-screen bg-background">
      <Cursor />
      <Navbar onBook={() => openBooking()} />
      <main>
        <section className="dining-hero dark-surface relative overflow-hidden px-6 pb-20 pt-40 lg:px-12 lg:pb-28 lg:pt-52">
          <div className="dining-hero-grid" />
          <div className="mx-auto grid max-w-[1400px] items-center gap-12 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="relative z-10">
              <p className="eyebrow text-gold">Dining at Nakshatra</p>
              <h1 className="mt-5 max-w-3xl font-display text-[clamp(4rem,10vw,10rem)] leading-[0.78] text-[var(--color-ivory)]">
                Good evenings <span className="italic text-gold">begin here.</span>
              </h1>
              <p className="mt-8 max-w-lg text-base leading-relaxed text-[var(--color-ivory)]/85">
                Discover three distinctive dining experiences, each with its own atmosphere,
                character and culinary identity.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href="#vrindavan"
                  className="luxury-button luxury-button-hover inline-flex items-center gap-2 px-6 py-3"
                >
                  Explore dining <ArrowDownRight className="size-4" />
                </a>
                <button
                  onClick={() => openBooking()}
                  className="luxury-button-ghost editorial-panel-button px-6 py-3"
                >
                  Reserve now
                </button>
              </div>
            </div>
            <div className="relative z-10 hidden lg:block">
              {(() => {
                const heroExperience =
                  diningExperiences.find((item) => item.id === selectedId) ?? diningExperiences[0]!;
                const images = getSelectedDiningImages(
                  diningImageLibrary,
                  "diningHero",
                  heroExperience.diningType,
                ).slice(0, displayCounts[heroExperience.diningType].diningHero);
                return <SpatialGallery experience={heroExperience} images={images} />;
              })()}
            </div>
          </div>
          <div className="relative z-10 mx-auto mt-16 flex max-w-[1400px] flex-wrap gap-5 border-t border-gold/30 pt-5">
            {diningExperiences.map((experience) => (
              <a
                key={experience.id}
                href={`#${experience.id}`}
                className={`eyebrow transition-colors ${selectedId === experience.id ? "text-gold" : "text-[var(--color-ivory)]/70 hover:text-gold"}`}
              >
                0{diningExperiences.indexOf(experience) + 1} {experience.name}
              </a>
            ))}
          </div>
        </section>

        {diningExperiences.map((experience, index) => (
          <ExperienceSection
            key={experience.id}
            experience={experience}
            images={getSelectedDiningImages(
              diningImageLibrary,
              "diningPage",
              experience.diningType,
            ).slice(0, displayCounts[experience.diningType].diningPage)}
            index={index}
            onBook={() => openBooking()}
          />
        ))}
      </main>
      <Footer onBook={() => openBooking()} />
      <BookingPanel open={booking} details={bookingDetails} onClose={() => setBooking(false)} />
    </div>
  );
}
