"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import { Cursor } from "@/components/Cursor";
import { Navbar } from "@/components/Navbar";
import { BookingPanel } from "@/components/BookingPanel";
import { ContactPanel } from "@/components/ContactPanel";
import { Footer } from "@/sections/Footer";
import { setupHomeAnimations } from "@/home/animations/homeAnimations";
import { Hero } from "@/home/components/Hero/Hero";
import type { BookingDetails } from "@/home/components/Booking/BookingWidget";
import { AboutPreview } from "@/home/components/About/AboutPreview";
import { RoomsPreview } from "@/home/components/Rooms/RoomsPreview";
import { DiningPreview } from "@/home/components/Dining/DiningPreview";
import { Amenities } from "@/home/components/Amenities/Amenities";
import { Experience } from "@/home/components/Experience/Experience";
import { GalleryPreview } from "@/home/components/Gallery/GalleryPreview";
import { Testimonials } from "@/home/components/Testimonials/Testimonials";
import { LocationPreview } from "@/home/components/Location/LocationPreview";
import { BookingCTA } from "@/home/components/BookingCTA/BookingCTA";

export function Home({ contactOpen = false }: { contactOpen?: boolean }) {
  const [booking, setBooking] = useState(false);
  const [contact, setContact] = useState(contactOpen);
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
  const root = useRef<HTMLElement>(null);
  const openBooking = useCallback((details?: BookingDetails) => {
    if (details) setBookingDetails(details);
    setBooking(true);
  }, []);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cleanup = root.current ? setupHomeAnimations(root.current) : undefined;
    const lenis = new Lenis({ duration: 1.2, smoothWheel: true });
    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cleanup?.();
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);
  return (
    <>
      <Cursor />
      <Navbar onBook={openBooking} />
      <main ref={root} className="readable-content relative">
        <Hero onBook={openBooking} />
        <AboutPreview />
        <RoomsPreview onBook={openBooking} />
        <DiningPreview />
        <Amenities />
        <Experience />
        <GalleryPreview />
        <Testimonials />
        <LocationPreview />
        <BookingCTA onBook={openBooking} />
        <Footer onBook={openBooking} />
      </main>
      <BookingPanel open={booking} details={bookingDetails} onClose={() => setBooking(false)} />
      <ContactPanel open={contact} onClose={() => setContact(false)} />
    </>
  );
}
