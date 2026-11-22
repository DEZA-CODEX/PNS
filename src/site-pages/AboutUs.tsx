"use client";

import {
  Accessibility,
  AirVent,
  Coffee,
  DoorOpen,
  Facebook,
  Instagram,
  Laptop,
  MapPin,
  Phone,
  Refrigerator,
  ShieldCheck,
  Sparkles,
  Utensils,
  Wifi,
} from "lucide-react";
import { useState } from "react";

import { BookingPanel } from "@/components/BookingPanel";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/sections/Footer";
import { heroHotelImage } from "@/data/imageManifest";
import roomPremier from "@/assets/room-premier.jpg";
import roomSuite from "@/assets/room-suite.jpg";
import diningCloud9 from "@/assets/dining-cloud9.jpg";
import diningVrindavan from "@/assets/dining-vrindavan.jpg";
import clinqLounge from "@/assets/clinq-lounge.jpg";
import eventsBanquet from "@/assets/events-banquet.jpg";
import { useAboutImages } from "@/hooks/useAboutImages";
import { diningImageRepository, getSelectedDiningImages } from "@/services/roomImageRepository";

const facilities = [
  ["VRINDAVAN", "Fine Vegetarian Restaurant", diningVrindavan.src],
  ["CLOUD NINE", "Multi Cuisine Rooftop Family Restaurant", diningCloud9.src],
  ["CLINQ", "Casual Lounge Bar", clinqLounge.src],
  ["TAVISHA", "Board Room", eventsBanquet.src],
  ["TVASISTA", "Kitty Party Room", eventsBanquet.src],
  ["TAMARA", "Pillarless Banquet / Party Hall", eventsBanquet.src],
  ["TITIKSHA", "Board Room", eventsBanquet.src],
  ["TRAVEL DESK", "Pickup & Drop, Vehicle on Rent", heroHotelImage.src],
] as const;

const amenities = [
  ["24 Centrally Air Conditioned Rooms", AirVent],
  ["32” / 43” LED TV with DTH Connection", Laptop],
  ["Hot Water Kettle (Tea / Coffee Maker)", Coffee],
  ["24 Hours Hot Water Shower", Sparkles],
  ["Electronic Safety Locker", ShieldCheck],
  ["Mini Fridge", Refrigerator],
  ["High Speed Wi-Fi Connectivity", Wifi],
  ["Office Desk & Chair", Accessibility],
  ["Laundry Facility", Utensils],
  ["Iron Board & Iron Box", DoorOpen],
  ["Bath Kit & Self Care Kit", Sparkles],
  ["In-Room Dining", Utensils],
] as const;

const attractions = [
  [
    "VELLORE FORT",
    "Built during the Vijayanagar period, Vellore Fort is known for its massive ramparts, historic architecture and intricate details.",
    heroHotelImage.src,
  ],
  [
    "SRI LAXMI NARAYANI GOLDEN TEMPLE",
    "Located at Sripuram, the Golden Temple is a remarkable spiritual destination known for its striking golden architecture and serene surroundings.",
    diningVrindavan.src,
  ],
  [
    "VELLORE MUSEUM",
    "Discover Vellore's history and cultural heritage through the collections and exhibits preserved at the Government Museum.",
    roomSuite.src,
  ],
  [
    "AMIRTHI ZOOLOGICAL PARK",
    "Located around 25 kilometres from Vellore, Amirthi Zoological Park offers a refreshing escape into nature.",
    heroHotelImage.src,
  ],
  [
    "JALAKANDESWARAR TEMPLE",
    "Situated within the Vellore Fort complex, this temple is an impressive example of traditional Dravidian architecture and craftsmanship.",
    eventsBanquet.src,
  ],
] as const;

const nearby = [
  ["CMC Vellore Campus", "2.4 km"],
  ["CMC Ranipet Campus", "6.4 km"],
  ["VIT Campus", "8.1 km"],
  ["Vellore Fort", "6.9 km"],

  ["Jalakandeswarar Temple", "7.1 km"],
  ["Sri Selva Vinayagar Temple", "10.0 km"],
];
const services = [
  [
    "24-HOUR FRONT DESK",
    "Need something anytime? Our friendly staff is always available to assist with requests or local recommendations.",
  ],
  [
    "HOUSEKEEPING SERVICES",
    "Relax and unwind knowing your space is kept clean and tidy with our daily housekeeping service.",
  ],
  [
    "WIFI & INTERNET",
    "Stay connected with loved ones or catch up on work with high-speed Wi-Fi throughout the premises.",
  ],
  [
    "LAUNDRY SERVICES",
    "Full-service laundry for convenience, with self-service options where applicable.",
  ],
  [
    "BREAKFAST IN BED",
    "Start your morning right with a delicious breakfast available at an additional charge.",
  ],
  ["PRIVATE PARKING", "Enjoy the convenience of private parking during your stay."],
  [
    "DOCTOR ON CALL",
    "For your peace of mind, doctor-on-call assistance is available when required.",
  ],
  [
    "AIR CONDITIONING",
    "Enjoy a comfortable climate with individually controlled air conditioning.",
  ],
  ["BATH KIT", "Enjoy a complimentary bath kit with essential premium toiletries."],
];

export function AboutUs() {
  const [booking, setBooking] = useState(false);
  const { images: diningImageLibrary } = useAboutImages();
  const aboutDiningImage = (name: string) => {
    const diningType =
      name === "VRINDAVAN"
        ? "vrindavan"
        : name === "CLOUD NINE"
          ? "cloud9"
          : name === "CLINQ"
            ? "clinq"
            : null;
    return diningType
      ? getSelectedDiningImages(diningImageLibrary, "aboutPage", diningType)[0]?.url
      : undefined;
  };
  const openBooking = () => setBooking(true);
  return (
    <>
      <Navbar onBook={openBooking} />
      <main className="about-page readable-content">
        <section className="about-hero dark-surface" id="top">
          <div className="about-hero-scene" aria-hidden="true">
            <img
              src={diningCloud9.src}
              alt=""
              className="h-full w-full object-cover"
              loading="eager"
            />
          </div>
          <div className="about-hero-shade" />
          <div className="about-hero-copy">
            <p className="eyebrow text-gold">Premier luxury in Vellore</p>
            <h1 className="mt-5 max-w-3xl font-display text-[clamp(4rem,11vw,10rem)] leading-[0.82] tracking-[-0.03em] text-white">
              About the <i className="text-gold">hotel.</i>
            </h1>
            <p className="mt-7 max-w-lg text-lg leading-relaxed text-[var(--color-ivory)]">
              Experience the ultimate in comfort and luxury, shaped by thoughtful spaces and the
              warmth of Vellore.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a href="#welcome" className="luxury-button-ghost px-6 py-3 text-cream">
                Explore the hotel
              </a>
              <button onClick={openBooking} className="luxury-button luxury-button-hover px-6 py-3">
                Book your stay
              </button>
            </div>
          </div>
        </section>
        <section className="about-section about-story" id="welcome">
          <div className="about-story-grid">
            <div>
              <h2 className="about-title about-story-title">
                <span>A considered stay,</span>
                <i>made personal.</i>
              </h2>
            </div>
            <div className="about-story-copy space-y-5 text-lg text-muted-foreground">
              <p>
                Hotel PNS Nakshatra is a contemporary 3-star luxury hotel situated in the vibrant
                city of Vellore. Established with a vision to provide an unparalleled hospitality
                experience, our journey began with a dream to create a haven of comfort and luxury
                for travelers.
              </p>
              <p>
                Located on the bustling Chennai–Bangalore Highway, the hotel offers a serene escape
                amidst the scenic foothills, providing guests with an oasis of tranquillity while
                keeping the city&apos;s important destinations within easy reach.
              </p>
              <a href="#contact" className="text-link">
                Discover our address
              </a>
            </div>
          </div>
          <div className="about-image-strip">
            <img
              src={heroHotelImage.src}
              alt="Hotel PNS Nakshatra illuminated facade"
              loading="lazy"
            />
            <div>
              <span className="eyebrow">Vellore · Tamil Nadu</span>
              <p className="mt-2 font-display text-3xl text-gold">
                A quiet landmark on the highway.
              </p>
            </div>
          </div>
        </section>
        <section className="about-section about-experience">
          <div className="about-feature-grid">
            <img
              src={roomPremier.src}
              alt="Vajra Premium Room at Hotel PNS Nakshatra"
              loading="lazy"
            />
            <div className="about-feature-copy">
              <p className="eyebrow text-gold">Vajra Premium Rooms</p>
              <h2 className="about-title about-comfort-title mt-8">
                Naturally comfortable
                <br />
                <i>private spaces.</i>
              </h2>
              <p className="mt-6 max-w-md text-lg text-muted-foreground">
                Our Vajra Premium Rooms are designed to provide a serene and sophisticated
                environment. Elegantly furnished and equipped with modern amenities, they make room
                for both rest and focus.
              </p>
              <button
                onClick={openBooking}
                className="luxury-button luxury-button-hover mt-8 px-6 py-3"
              >
                Book your stay
              </button>
            </div>
          </div>
        </section>
        <section className="about-section about-accommodation">
          <div className="about-story-grid">
            <h2 className="about-title about-accommodation-heading">
              Elegant accommodations
              <br />
              <i>for every traveler.</i>
            </h2>
            <div>
              <p className="text-lg text-muted-foreground">
                At Hotel PNS Nakshatra, we take pride in offering a diverse range of luxurious rooms
                and suites designed to meet the needs of every traveler. Each room is thoughtfully
                furnished with modern amenities and exudes a sense of comfort and elegance.
              </p>
              <div className="about-room-images mt-8">
                <img src={roomSuite.src} alt="Nakshatra Suite living space" loading="lazy" />
                <img src={roomPremier.src} alt="Premium room details" loading="lazy" />
              </div>
              <button
                onClick={openBooking}
                className="luxury-button luxury-button-hover mt-8 px-6 py-3"
              >
                Book your stay
              </button>
            </div>
          </div>
        </section>
        <section className="about-section about-dark dark-surface" id="facilities">
          <h2 className="about-title text-gold">
            <span style={{ color: "#FFFFFF" }}>Spaces with a</span>
            <br />
            <i className="text-gold">sense of occasion.</i>
          </h2>
          <div className="facility-grid">
            {facilities.map(([name, detail, image]) => (
              <article className="facility-item" key={name}>
                {name === "VRINDAVAN" || name === "CLOUD NINE" || name === "CLINQ" ? (
                  aboutDiningImage(name) ? (
                    <img
                      src={aboutDiningImage(name)}
                      alt={`${name} dining at Hotel PNS Nakshatra`}
                      loading="lazy"
                      onError={() => {
                        const diningType =
                          name === "VRINDAVAN"
                            ? "vrindavan"
                            : name === "CLOUD NINE"
                              ? "cloud9"
                              : "clinq";
                        const image = getSelectedDiningImages(
                          diningImageLibrary,
                          "aboutPage",
                          diningType,
                        )[0];
                        if (image) diningImageRepository.reportUnavailable(image.id);
                      }}
                    />
                  ) : null
                ) : (
                  <img src={image} alt="" loading="lazy" />
                )}
                <div>
                  <p className="eyebrow text-gold">{name}</p>
                  <p className="mt-2 text-sm text-[var(--color-ivory)]">{detail}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="about-section about-amenities">
          <div className="about-story-grid">
            <h2 className="about-title about-amenities-heading">
              Everything in its
              <br />
              <i>right place.</i>
            </h2>
            <div className="amenities-grid">
              {amenities.map(([label, Icon]) => (
                <div className="amenity-item" key={label}>
                  <Icon size={18} strokeWidth={1.4} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="about-section about-services about-dark dark-surface">
          <h2 className="about-title text-cream">
            <span style={{ color: "#FFFFFF" }}>Care that arrives</span>
            <br />
            <i className="text-gold">before you ask.</i>
          </h2>
          <p className="mt-6 max-w-xl text-lg text-[var(--color-ivory)]">
            At Hotel PNS Nakshatra, we are dedicated to providing our guests with a luxurious and
            comfortable stay, ensuring every need is met with impeccable service.
          </p>
          <div className="services-grid">
            {services.map(([name, detail]) => (
              <article key={name}>
                <p className="eyebrow text-gold">{name}</p>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-ivory)]">{detail}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="about-section about-vellore">
          <div className="about-story-grid">
            <div>
              <h2 className="about-title about-nearby-title">
                Discover the places
                <br />
                <i>around PNS Nakshatra.</i>
              </h2>
              <p className="mt-6 max-w-md text-lg text-muted-foreground">
                Vellore blends history, spirituality, architecture and natural beauty. During your
                stay, explore some of the city&apos;s most distinctive attractions and nearby
                escapes.
              </p>
            </div>
            <div className="attraction-grid">
              {attractions.map(([name, detail, image]) => {
                const isDiningImage = name === "SRI LAXMI NARAYANI GOLDEN TEMPLE";
                const attractionImage = isDiningImage ? aboutDiningImage("VRINDAVAN") : image;
                return (
                  <article className="attraction-item" key={name}>
                    {attractionImage ? <img src={attractionImage} alt="" loading="lazy" /> : null}
                    <div>
                      <p className="eyebrow text-gold">{name}</p>
                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{detail}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
        <section className="about-section about-nearby">
          <div className="nearby-layout">
            <div>
              <h2 className="about-title">
                Close to the
                <br />
                <i>city&apos;s pulse.</i>
              </h2>
              <div className="nearby-pin">
                <MapPin size={20} />
                <span>PNS NAKSHATRA</span>
              </div>
            </div>
            <div className="nearby-list">
              {nearby.map(([place, distance]) => (
                <div key={place}>
                  <span>{place}</span>
                  <strong>{distance}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer onBook={openBooking} />
      <BookingPanel
        open={booking}
        details={{
          roomTypes: [],
          checkIn: "",
          checkOut: "",
          adults: 2,
          children: 0,
          rooms: 1,
          travelingForWork: false,
          travelingWithPets: false,
        }}
        onClose={() => setBooking(false)}
      />
    </>
  );
}
