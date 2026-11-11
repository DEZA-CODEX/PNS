"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import logo from "@/assets/pns logo.png";
import logoWebp from "@/assets/pns-logo.webp";
import { roomCategories } from "@/data/rooms";

const links = [
  { label: "Home", href: "/" },
  { label: "About Us", href: "/about-us" },
  { label: "Rooms", href: "/rooms" },
  { label: "Dining", href: "/dining" },
  { label: "Banquet", href: "/banquet" },
  { label: "Gallery", href: "/gallery" },
  { label: "Contact", href: "/contact" },
];

const galleryLinks = [
  { label: "Rooms", href: "/rooms" },
  { label: "Banquet", href: "/banquet" },
  { label: "Dining", href: "/dining" },
];

const diningLinks = [
  { label: "Vrindavan", href: "/dining#vrindavan", description: "Veg fine dining" },
  { label: "Cloud 9", href: "/dining#cloud-9", description: "Rooftop restaurant" },
  { label: "Clinq", href: "/dining#clinq", description: "Casual bar & lounge" },
];

const roomLinks = roomCategories.map((room) => ({
  label: room.name,
  href: "/rooms#rooms",
  description: room.category,
}));

const banquetLinks = [
  {
    label: "Weddings & receptions",
    href: "/banquet#enquire",
    description: "Memorable celebrations",
  },
  {
    label: "Engagements & anniversaries",
    href: "/banquet#enquire",
    description: "Special occasions",
  },
  { label: "Birthday celebrations", href: "/banquet#enquire", description: "Celebrate together" },
  {
    label: "Family & private functions",
    href: "/banquet#enquire",
    description: "Gather beautifully",
  },
  { label: "Corporate meetings", href: "/banquet#enquire", description: "Professional events" },
  {
    label: "Business events & launches",
    href: "/banquet#enquire",
    description: "Bring ideas to life",
  },
];

export function Navbar({ onBook }: { onBook: () => void }) {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGalleryOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-[60] transition-all duration-500 ${
        solid
          ? "glass-panel border-x-0 border-t-0 bg-background/88 py-2"
          : "border-b border-border bg-background/68 py-[clamp(0.75rem,2vw,1rem)] backdrop-blur-md"
      }`}
    >
      <nav className="flex w-full items-center justify-between px-[clamp(1rem,3vw,2rem)]">
        <a href="#top" className="leading-none" data-cursor="Home">
          <picture>
            <source srcSet={logoWebp.src} type="image/webp" />
            <img
              src={logo.src}
              alt="PNS Nakshatra"
              width={288}
              height={144}
              decoding="async"
              className="h-[clamp(3.25rem,5vw,4.5rem)] w-auto object-contain"
            />
          </picture>
        </a>

        <ul className="hidden items-center gap-[clamp(1.25rem,3vw,2.5rem)] lg:flex">
          {links.map((l) => (
            <li key={l.href}>
              <div
                className={`group relative ${l.label === "Gallery" && galleryOpen ? "is-open" : ""}`}
              >
                {l.label === "Gallery" ? (
                  <a
                    href={l.href}
                    className={`eyebrow text-[calc(var(--type-label)_+_2px)] transition-colors underline-offset-4 decoration-[1px] hover:text-[#000000] hover:underline lg:text-[calc(0.78rem_+_2px)] ${pathname === l.href ? "text-[#000000] underline" : ""}`}
                    data-cursor=""
                  >
                    {l.label}
                  </a>
                ) : (
                  <a
                    href={l.href}
                    className={`eyebrow text-[calc(var(--type-label)_+_2px)] transition-colors underline-offset-4 decoration-[1px] hover:text-[#000000] hover:underline lg:text-[calc(0.78rem_+_2px)] ${pathname === l.href ? "text-[#000000] underline" : ""}`}
                    data-cursor=""
                  >
                    {l.label}
                  </a>
                )}
                {l.label === "Gallery" ? (
                  <div className="pointer-events-none absolute left-1/2 top-full z-[70] mt-0 w-44 -translate-x-1/2 translate-y-2 border border-gold/40 bg-[var(--color-navy)] p-2 opacity-0 shadow-[var(--shadow-cinema)] transition-all group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-[.is-open]:pointer-events-auto group-[.is-open]:translate-y-0 group-[.is-open]:opacity-100">
                    {galleryLinks.map((item) => (
                      <a
                        key={item.href}
                        href={item.href}
                        onClick={() => setGalleryOpen(false)}
                        className="block px-3 py-2.5 text-[calc(0.75rem_+_2px)] font-semibold uppercase tracking-[0.12em] text-[var(--color-ivory)] transition-colors underline-offset-2 decoration-[1px] hover:bg-[color-mix(in_oklab,var(--color-ivory)_10%,transparent)] hover:text-gold hover:underline focus-visible:bg-[color-mix(in_oklab,var(--color-ivory)_10%,transparent)] focus-visible:text-gold"
                      >
                        {item.label}
                      </a>
                    ))}
                  </div>
                ) : l.label === "Dining" ? (
                  <div className="pointer-events-none absolute left-1/2 top-full z-[70] mt-0 w-52 -translate-x-1/2 translate-y-2 border border-gold/40 bg-[var(--color-navy)] p-3 opacity-0 shadow-[var(--shadow-cinema)] transition-all group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100">
                    {diningLinks.map((item) => (
                      <a
                        key={item.href}
                        href={item.href}
                        className="group/dropdown-item block px-3 py-2 text-[calc(0.75rem_+_2px)] font-semibold uppercase tracking-[0.12em] text-[var(--color-ivory)] transition-colors underline-offset-2 decoration-[1px] hover:bg-[color-mix(in_oklab,var(--color-ivory)_10%,transparent)] hover:text-gold hover:underline focus-visible:bg-[color-mix(in_oklab,var(--color-ivory)_10%,transparent)] focus-visible:text-gold"
                      >
                        <span className="block">{item.label}</span>
                        <span className="mt-1 block text-[calc(0.6rem_+_2px)] font-normal tracking-[0.08em] text-[var(--color-ivory)]/70 group-hover/dropdown-item:text-[var(--color-ivory)]">
                          {item.description}
                        </span>
                      </a>
                    ))}
                  </div>
                ) : l.label === "Rooms" ? (
                  <div className="pointer-events-none absolute left-1/2 top-full z-[70] mt-0 w-52 -translate-x-1/2 translate-y-2 border border-gold/40 bg-[var(--color-navy)] p-3 opacity-0 shadow-[var(--shadow-cinema)] transition-all group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100">
                    {roomLinks.map((item) => (
                      <a
                        key={item.label}
                        href={item.href}
                        className="group/dropdown-item block px-3 py-2 text-[calc(0.75rem_+_2px)] font-semibold uppercase tracking-[0.12em] text-[var(--color-ivory)] transition-colors underline-offset-2 decoration-[1px] hover:bg-[color-mix(in_oklab,var(--color-ivory)_10%,transparent)] hover:text-gold hover:underline focus-visible:bg-[color-mix(in_oklab,var(--color-ivory)_10%,transparent)] focus-visible:text-gold"
                      >
                        <span className="block">{item.label}</span>
                        <span className="mt-1 block text-[calc(0.6rem_+_2px)] font-normal tracking-[0.08em] text-[var(--color-ivory)]/70 group-hover/dropdown-item:text-[var(--color-ivory)]">
                          {item.description}
                        </span>
                      </a>
                    ))}
                  </div>
                ) : l.label === "Banquet" ? (
                  <div className="pointer-events-none absolute left-1/2 top-full z-[70] mt-0 w-64 -translate-x-1/2 translate-y-2 border border-gold/40 bg-[var(--color-navy)] p-3 opacity-0 shadow-[var(--shadow-cinema)] transition-all group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100">
                    {banquetLinks.map((item) => (
                      <a
                        key={item.label}
                        href={item.href}
                        className="group/dropdown-item block px-3 py-2 text-[calc(0.75rem_+_2px)] font-semibold uppercase tracking-[0.12em] text-[var(--color-ivory)] transition-colors underline-offset-2 decoration-[1px] hover:bg-[color-mix(in_oklab,var(--color-ivory)_10%,transparent)] hover:text-gold hover:underline focus-visible:bg-[color-mix(in_oklab,var(--color-ivory)_10%,transparent)] focus-visible:text-gold"
                      >
                        <span className="block">{item.label}</span>
                        <span className="mt-1 block text-[calc(0.6rem_+_2px)] font-normal tracking-[0.08em] text-[var(--color-ivory)]/70 group-hover/dropdown-item:text-[var(--color-ivory)]">
                          {item.description}
                        </span>
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-4">
          <button
            onClick={onBook}
            data-cursor=""
            className="luxury-button luxury-button-hover hidden px-5 py-2.5 lg:block"
          >
            Book your stay
          </button>
          <button
            aria-label="Menu"
            aria-expanded={open}
            aria-controls="mobile-navigation"
            onClick={() => setOpen((v) => !v)}
            className="flex size-11 flex-col items-center justify-center gap-1.5 lg:hidden"
          >
            <span className="block h-px w-6 bg-cream" />
            <span className="block h-px w-6 bg-cream" />
            <span className="block h-px w-6 bg-cream" />
          </button>
        </div>
      </nav>

      <div
        id="mobile-navigation"
        hidden={!open}
        inert={!open}
        className={`glass-panel mx-[clamp(1rem,4vw,1.5rem)] mt-3 flex-col gap-5 p-6 lg:hidden ${
          open ? "flex" : "hidden"
        }`}
      >
        {links.map((l) =>
          l.label === "Gallery" ? (
            <div key={l.href} className="border-b border-gold/20 pb-4">
              <button
                type="button"
                aria-expanded={galleryOpen}
                aria-haspopup="true"
                onClick={() => setGalleryOpen((value) => !value)}
                className="eyebrow text-[calc(var(--type-label)_+_2px)] transition-colors hover:text-[#000000]"
                data-cursor=""
              >
                Gallery
              </button>
              {galleryOpen ? (
                <div className="mt-3 grid grid-cols-3 gap-2 pl-3">
                  {galleryLinks.map((item) => (
                    <a
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="eyebrow text-[calc(var(--type-label)_+_2px)] text-[var(--color-navy-soft)] transition-colors hover:text-[var(--color-navy)] hover:underline"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ) : l.label === "Rooms" ? (
            <div key={l.href} className="border-b border-gold/20 pb-4">
              <a
                href={l.href}
                className={`eyebrow text-[calc(var(--type-label)_+_2px)] transition-colors hover:text-[#000000] ${pathname === l.href ? "text-[#000000] underline" : ""}`}
                data-cursor=""
              >
                Rooms
              </a>
              <div className="mt-3 grid grid-cols-2 gap-2 pl-3">
                {roomLinks.map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="eyebrow text-[calc(var(--type-label)_+_2px)] text-[var(--color-navy-soft)] transition-colors hover:text-[var(--color-navy)] hover:underline"
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
          ) : l.label === "Banquet" ? (
            <div key={l.href} className="border-b border-gold/20 pb-4">
              <a
                href={l.href}
                className={`eyebrow text-[calc(var(--type-label)_+_2px)] transition-colors hover:text-[#000000] ${pathname === l.href ? "text-[#000000] underline" : ""}`}
                data-cursor=""
              >
                Banquet
              </a>
              <div className="mt-3 grid gap-2 pl-3">
                {banquetLinks.map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="eyebrow text-[calc(var(--type-label)_+_2px)] text-[var(--color-navy-soft)] transition-colors hover:text-[var(--color-navy)] hover:underline"
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <a
              key={l.href}
              href={l.href}
              className={`eyebrow text-[calc(var(--type-label)_+_2px)] transition-colors underline-offset-4 decoration-[1px] hover:text-[#000000] hover:underline ${pathname === l.href ? "text-[#000000] underline" : ""}`}
              onClick={() => setOpen(false)}
              data-cursor=""
            >
              {l.label}
            </a>
          ),
        )}
        <div className="border-t border-gold/20 pt-4">
          <p className="eyebrow text-ink">Dining</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {["vrindavan", "cloud-9", "clinq"].map((section) => (
              <a
                key={section}
                href={`/dining#${section}`}
                onClick={() => setOpen(false)}
                className="eyebrow text-[calc(var(--type-label)_+_2px)] text-[var(--color-navy-soft)] transition-colors underline-offset-2 decoration-[1px] hover:text-[var(--color-navy)] hover:underline"
              >
                {section === "cloud-9"
                  ? "Cloud 9"
                  : section.charAt(0).toUpperCase() + section.slice(1)}
              </a>
            ))}
          </div>
        </div>
        <button
          onClick={() => {
            setOpen(false);
            onBook();
          }}
          className="luxury-button luxury-button-hover px-5 py-2.5"
        >
          Book your stay
        </button>
      </div>
    </header>
  );
}
