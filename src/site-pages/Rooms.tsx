"use client";

import { ArrowUpRight, Check, MapPin, Phone } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BookingPanel } from "@/components/BookingPanel";
import { BookingWidget } from "@/home/components/Booking/BookingWidget";
import type { BookingDetails } from "@/home/components/Booking/BookingWidget";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/sections/Footer";
import { comparisonAmenities, hasAmenity, roomCategories, type Room } from "@/data/rooms";
import { useRoomImages } from "@/hooks/useRoomImages";
import type { RoomImage } from "@/types/roomImages";

type DisplayRoom = Room & { image: string };

function RoomStage({
  rooms,
  activeIndex,
  images,
}: {
  rooms: DisplayRoom[];
  activeIndex: number;
  images: RoomImage[];
}) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [failedImageId, setFailedImageId] = useState<string | null>(null);
  const activeImages = images.filter((image) => image.roomType === rooms[activeIndex]?.id);
  const activeImage = activeImages[activeImageIndex % Math.max(activeImages.length, 1)];

  useEffect(() => {
    setActiveImageIndex(0);
    setFailedImageId(null);
    if (activeImages.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const timer = window.setInterval(
      () => setActiveImageIndex((current) => (current + 1) % activeImages.length),
      6000,
    );
    return () => window.clearInterval(timer);
  }, [activeIndex, activeImages.length]);

  return (
    <div className="relative h-[min(75vw,42rem)] min-h-[22rem] w-full overflow-hidden [perspective:1200px] lg:sticky lg:top-28">
      {activeImage && failedImageId !== activeImage.id ? (
        <img
          key={activeImage.id}
          src={activeImage.url}
          alt={activeImage.altText}
          width="1200"
          height="900"
          loading="eager"
          fetchPriority="high"
          onError={() => {
            setFailedImageId(activeImage.id);
            if (process.env.NODE_ENV === "development") {
              console.error(
                `Room image failed to load (${activeImage.roomType}/${activeImage.filename}): ${activeImage.url}`,
              );
            }
          }}
          className="absolute inset-0 size-full object-cover transition-[opacity,transform] duration-1000 ease-out"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_75%_35%,rgba(207,140,85,0.18),transparent_34%),linear-gradient(120deg,#051838_0%,#051838_100%)] text-center text-sm text-cream/75">
          {process.env.NODE_ENV === "development"
            ? `No valid Rooms page image is selected for ${rooms[activeIndex]?.name ?? "this room"}.`
            : null}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/60 via-transparent to-transparent" />
      <div className="pointer-events-none absolute inset-[8%] rounded-full border border-gold/50 opacity-75" />
      <div className="pointer-events-none absolute inset-x-10 bottom-8 flex justify-between border-t border-gold/50 pt-3 text-[0.65rem] uppercase tracking-[0.2em] text-cream/80">
        <span>{rooms[activeIndex]?.name} room study</span>
        <span>0{activeIndex + 1} / 05</span>
      </div>
    </div>
  );
}

function RoomCard({ room, index, onBook }: { room: Room; index: number; onBook: () => void }) {
  return (
    <article
      className="flex min-h-[31rem] flex-col justify-center border-t border-gold/40 py-16 text-[var(--color-ivory)] lg:min-h-[42rem] lg:py-24"
      data-room-index={index}
    >
      <p className="eyebrow text-gold">
        0{index + 1} / 05 · {room.category}
      </p>
      <h3 className="mt-4 font-display text-[clamp(3.2rem,7vw,7rem)] leading-[0.86] text-[var(--color-ivory)]">
        {room.name}
      </h3>
      <p className="mt-7 max-w-lg text-base leading-relaxed text-[var(--color-ivory)]/80">
        {room.description}
      </p>
      <ul className="mt-8 grid max-w-lg gap-x-8 gap-y-3 border-y border-gold/30 py-5 text-sm text-[var(--color-ivory)]/85 sm:grid-cols-2">
        {room.amenities.map((amenity) => (
          <li key={amenity} className="flex gap-2">
            <Check className="mt-1 size-3.5 shrink-0 text-gold" />
            {amenity}
          </li>
        ))}
      </ul>
      <div className="mt-7 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow text-[var(--color-ivory)]/85">From {room.price} / night</p>
          <p className="mt-1 text-xs text-[var(--color-ivory)]/70">{room.tax}</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <a
            href={room.detailsUrl}
            target="_blank"
            rel="noreferrer"
            className="luxury-button-ghost px-5 py-3"
          >
            Room details <ArrowUpRight className="ml-2 inline size-4" />
          </a>
          <button onClick={onBook} className="luxury-button luxury-button-hover px-5 py-3">
            Book this room
          </button>
        </div>
      </div>
    </article>
  );
}

export function Rooms() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [booking, setBooking] = useState(false);
  const [bookingDetails, setBookingDetails] = useState<BookingDetails>({
    roomTypes: [],
    checkIn: "",
    checkOut: "",
    adults: 2,
    children: 0,
    rooms: 1,
    travelingForWork: false,
    travelingWithPets: false,
  });
  const showcase = useRef<HTMLDivElement>(null);
  const { images } = useRoomImages("roomsPage");
  const displayRooms: DisplayRoom[] = roomCategories.map((room) => ({
    ...room,
    image: images.find((image) => image.roomType === room.id)?.url ?? "",
  }));
  const openBooking = (details?: BookingDetails) => {
    if (details) setBookingDetails(details);
    setBooking(true);
  };

  useEffect(() => {
    const element = showcase.current;
    if (!element) return;
    const updateActive = () => {
      const cards = [...element.querySelectorAll<HTMLElement>("[data-room-index]")];
      if (cards.length === 0) return;
      const midpoint = window.innerHeight * 0.48;
      let nearest = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      cards.forEach((card, index) => {
        const distance = Math.abs(card.getBoundingClientRect().top - midpoint);
        if (distance < nearestDistance) {
          nearest = index;
          nearestDistance = distance;
        }
      });
      setActiveIndex(nearest);
    };
    updateActive();
    window.addEventListener("scroll", updateActive, { passive: true });
    return () => window.removeEventListener("scroll", updateActive);
  }, []);

  return (
    <div className="readable-content bg-background">
      <Navbar onBook={() => openBooking()} />
      <main>
        <section className="dark-surface relative isolate min-h-screen overflow-hidden pb-10 pt-36 lg:pt-44">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_75%_35%,rgba(207,140,85,0.18),transparent_34%),linear-gradient(120deg,#051838_0%,#051838_58%,#051838_100%)]" />
          <div className="mx-auto grid max-w-[1440px] items-center gap-10 px-6 lg:grid-cols-[0.75fr_1.25fr] lg:px-12">
            <div className="relative z-10">
              <p className="eyebrow text-gold">Our accommodations</p>
              <h1 className="mt-5 font-display text-[clamp(4rem,10vw,10rem)] leading-[0.8] text-white">
                Stay
                <br />
                <span className="italic text-gold">with us.</span>
              </h1>
              <p className="italic text-gold">
                Spend your comfortable stay in the heart of beautiful Vellore.
              </p>
              <a
                href="#rooms"
                className="luxury-button luxury-button-hover mt-8 inline-flex px-6 py-3"
              >
                Explore rooms
              </a>
            </div>
            <div className="relative min-h-[22rem]">
              <RoomStage rooms={displayRooms} activeIndex={activeIndex} images={images} />
            </div>
          </div>
          <div className="relative z-10 mx-auto mt-8 max-w-[1240px] px-4 lg:px-10">
            <BookingWidget onBook={openBooking} showHeading />
          </div>
        </section>

        <section className="mx-auto max-w-[1400px] px-6 py-28 lg:px-12 lg:py-40">
          <p className="eyebrow text-gold">Welcome to PNS Nakshatra</p>
          <h2 className="mt-5 max-w-4xl font-display text-[clamp(3rem,7vw,6.5rem)] leading-[0.86] text-ink">
            Luxury rooms designed <span className="italic text-gold">around your stay.</span>
          </h2>
          <p className="mt-8 max-w-2xl text-base leading-relaxed text-muted-foreground">
            At Hotel PNS Nakshatra, we take pride in offering a diverse range of luxurious rooms in
            Vellore, thoughtfully designed to meet the needs of every traveler.
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            From thoughtfully designed premium rooms to expansive suites, each accommodation
            combines comfort, convenience and contemporary elegance.
          </p>
        </section>

        <section id="rooms" className="dark-surface bg-ink px-6 py-24 lg:px-12 lg:py-32">
          <div className="mx-auto max-w-[1400px]">
            <div className="mb-10 max-w-xl">
              <p className="italic text-gold">The room collection</p>
              <h2 className="mt-4 font-display text-5xl text-gold lg:text-7xl">
                Find your <span className="italic text-gold">space.</span>
              </h2>
            </div>
            <div ref={showcase} className="grid gap-8 lg:grid-cols-[0.88fr_1.12fr] lg:gap-16">
              <RoomStage rooms={displayRooms} activeIndex={activeIndex} images={images} />
              <div>
                {roomCategories.map((room, index) => (
                  <RoomCard key={room.id} room={room} index={index} onBook={() => openBooking()} />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1400px] px-6 py-24 lg:px-12 lg:py-36">
          <p className="eyebrow text-gold">Find your perfect stay</p>
          <h2 className="mt-4 max-w-3xl font-display text-5xl leading-none text-ink lg:text-7xl">
            A considered <span className="italic text-gold">comparison.</span>
          </h2>
          <div className="mt-12 overflow-x-auto border-y border-border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-ink">
                  <th className="py-5 pr-6 font-normal">Comfort detail</th>
                  {roomCategories.map((room) => (
                    <th key={room.id} className="px-4 py-5 font-display text-xl font-normal">
                      {room.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonAmenities.map((amenity) => (
                  <tr key={amenity} className="border-b border-border/70">
                    <th className="py-4 pr-6 font-normal text-muted-foreground">{amenity}</th>
                    {roomCategories.map((room) => (
                      <td key={room.id} className="px-4 py-4">
                        {hasAmenity(room, amenity) ? (
                          <Check
                            className="size-4 text-gold"
                            aria-label={`${room.name} includes ${amenity}`}
                          />
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="dark-surface bg-ink px-6 py-28 lg:px-12 lg:py-40">
          <div className="mx-auto max-w-[1100px] text-center">
            <p className="eyebrow text-gold">Your stay, your space</p>
            <h2 className="mt-5 font-display text-[clamp(3rem,8vw,8rem)] leading-[0.84] text-gold">
              Choose how you <span className="italic text-gold">stay.</span>
            </h2>
            <p className="mx-auto mt-7 max-w-xl text-base leading-relaxed text-cream/75">
              Choose the accommodation that fits your journey and experience comfort, convenience
              and refined hospitality at Hotel PNS Nakshatra.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-4">
              <button
                onClick={() => openBooking()}
                className="luxury-button luxury-button-hover px-6 py-4"
              >
                Check availability
              </button>
              <button onClick={() => openBooking()} className="luxury-button-ghost px-6 py-4">
                Reserve now
              </button>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-[1400px] gap-10 px-6 py-24 lg:grid-cols-[0.8fr_1.2fr] lg:px-12 lg:py-32">
          <div>
            <p className="eyebrow text-gold">Get in touch</p>
            <h2 className="mt-4 font-display text-6xl leading-none text-ink">
              Meet us
              <br />
              <span className="italic text-gold">in Vellore.</span>
            </h2>
            <a
              href="https://maps.app.goo.gl/MhVVYxgfvEiwWW6d8"
              target="_blank"
              rel="noreferrer"
              className="text-link mt-8"
            >
              Get directions <ArrowUpRight className="ml-2 size-4" />
            </a>
          </div>
          <div className="grid gap-7 text-sm text-muted-foreground sm:grid-cols-2">
            <div>
              <p className="eyebrow text-ink">Hotel PNS Nakshatra</p>
              <p className="mt-3 leading-relaxed">
                Hotel PNS Nakshatra is a symbol of elegance and sophistication, a contemporary
                3-star luxury hotel situated in the vibrant city of Vellore.
              </p>
              <p className="mt-4 leading-relaxed">
                No. 171, Arcot Main Road,
                <br />
                Rangapuram,
                <br />
                Vellore - 632009,
                <br />
                Tamil Nadu, India.
              </p>
            </div>
            <div className="space-y-3">
              <p className="eyebrow text-ink">Reservations</p>
              <a href="tel:04162266111" className="flex items-center gap-2 hover:text-gold">
                <Phone className="size-4 text-gold" />
                0416 2266111 / 0416 2266222
              </a>
              <a href="tel:+917598498603" className="flex items-center gap-2 hover:text-gold">
                <Phone className="size-4 text-gold" />
                +91 75984 98603
              </a>
              <a href="mailto:fo@hotelpnsnakshatra.com" className="block hover:text-gold">
                fo@hotelpnsnakshatra.com
              </a>
              <p className="pt-3 leading-relaxed">
                CLINQ - Bar: +91 75984 98605
                <br />
                Vrindavan Veg Restaurant: +91 75984 98605
                <br />
                Cloud 9 - Rooftop Restaurant: +91 75984 98602
              </p>
              <a
                href="https://maps.app.goo.gl/MhVVYxgfvEiwWW6d8"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 pt-2 hover:text-gold"
              >
                <MapPin className="size-4 text-gold" />
                Get directions
              </a>
            </div>
          </div>
        </section>
        <Footer onBook={() => openBooking()} />
      </main>
      <BookingPanel open={booking} details={bookingDetails} onClose={() => setBooking(false)} />
    </div>
  );
}
