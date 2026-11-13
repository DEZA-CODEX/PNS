import { Facebook, Instagram, Mail, MapPin, Phone } from "lucide-react";
import logo from "@/assets/pns logo.png";
import logoWebp from "@/assets/pns-logo.webp";
import heroHotel from "@/assets/hero-bg/hero-hotel.jpg";

const navigation = [
  ["Home", "/"],
  ["About Us", "/about-us"],
  ["Rooms", "/rooms"],
  ["Dining", "/dining"],
  ["Banquet", "/banquet"],
  ["Gallery", "/gallery"],
  ["Contact", "/contact"],
] as const;

export function Footer({ onBook }: { onBook: () => void }) {
  return (
    <footer className="site-footer dark-surface relative isolate flex min-h-[42rem] flex-col overflow-hidden bg-[#051838] text-[var(--color-ivory)] sm:min-h-[38rem] lg:min-h-[clamp(34rem,40vw,48rem)]">
      <img
        src={heroHotel.src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="absolute inset-0 z-0 size-full object-fill"
      />
      <div className="absolute inset-0 z-0 bg-[linear-gradient(180deg,rgba(5,24,56,0.08)_0%,rgba(5,24,56,0.4)_38%,rgba(5,24,56,0.96)_100%)]" />
      <div className="absolute inset-0 z-0 bg-gradient-to-r from-[#051838]/50 via-transparent to-[#051838]/45" />

      <div className="relative z-10 mx-auto mt-auto grid w-full max-w-[1400px] grid-cols-1 gap-8 px-5 pb-8 pt-16 sm:grid-cols-2 sm:px-8 lg:grid-cols-[0.85fr_1.1fr_1.55fr] lg:gap-0 lg:px-10 lg:pb-10">
        <div className="flex min-w-0 flex-col items-start justify-center sm:col-span-2 lg:col-span-1 lg:pr-8">
          <a href="/" className="inline-block" aria-label="Hotel PNS Nakshatra home">
            <picture>
              <source srcSet={logoWebp.src} type="image/webp" />
              <img
                src={logo.src}
                alt="Hotel PNS Nakshatra"
                width={288}
                height={144}
                decoding="async"
                className="h-16 w-auto object-contain sm:h-20"
              />
            </picture>
          </a>
          <button
            onClick={onBook}
            className="luxury-button luxury-button-hover mt-5 w-fit px-6 py-3 text-xs font-semibold uppercase tracking-[0.14em]"
          >
            Book your stay
          </button>
        </div>

        <div className="min-w-0 border-white/25 sm:col-span-1 lg:border-l lg:px-10">
          <p className="eyebrow text-gold">Explore</p>
          <nav
            aria-label="Footer primary"
            className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm text-white/90"
          >
            {navigation.map(([label, href]) => (
              <a key={href} href={href} className="w-fit transition-colors hover:text-gold">
                {label}
              </a>
            ))}
          </nav>
        </div>

        <div className="min-w-0 border-white/25 sm:col-span-2 lg:col-span-1 lg:border-l lg:pl-10">
          <p className="eyebrow text-gold">Contact</p>
          <div className="mt-4 grid gap-3 text-sm leading-6 text-white/90">
            <a
              href="tel:+917598498603"
              className="inline-flex items-start gap-3 transition-colors hover:text-gold"
            >
              <Phone className="mt-1 size-4 shrink-0 text-gold" aria-hidden="true" />
              <span>Room reservations: +91 75984 98603</span>
            </a>
            <a
              href="tel:04162266111"
              className="inline-flex items-start gap-3 transition-colors hover:text-gold"
            >
              <Phone className="mt-1 size-4 shrink-0 text-gold" aria-hidden="true" />
              <span>Phone: 0416 2266111 / 0416 2266222</span>
            </a>
            <a
              href="mailto:fo@hotelpnsnakshatra.com"
              className="inline-flex min-w-0 items-start gap-3 transition-colors hover:text-gold"
            >
              <Mail className="mt-1 size-4 shrink-0 text-gold" aria-hidden="true" />
              <span className="break-all">fo@hotelpnsnakshatra.com</span>
            </a>
            <a
              href="https://maps.app.goo.gl/MhVVYxgfvEiwWW6d8"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-start gap-3 text-gold transition-colors hover:text-white"
            >
              <MapPin className="mt-1 size-4 shrink-0" aria-hidden="true" />
              <span>Get directions</span>
            </a>
          </div>
        </div>
      </div>

      <div className="relative z-10 border-t border-white/25">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-5 py-5 text-[0.65rem] uppercase tracking-[0.1em] text-white/80 sm:px-8 md:flex-row md:flex-wrap md:items-center md:justify-between lg:px-10">
          <span>© {new Date().getFullYear()} Hotel PNS Nakshatra</span>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-2">
            <a href="/privacy-policy" className="transition-colors hover:text-gold">
              Privacy policy
            </a>
            <a href="/terms-and-conditions" className="transition-colors hover:text-gold">
              Terms and conditions
            </a>
            <a href="/refund-cancellation-policy" className="transition-colors hover:text-gold">
              Refund &amp; cancellation policy
            </a>
          </nav>
          <div className="flex items-center gap-5 text-gold">
            <a
              href="https://www.facebook.com/pnsnakshatra"
              target="_blank"
              rel="noreferrer"
              aria-label="Facebook"
              className="transition-colors hover:text-white"
            >
              <Facebook className="size-4" />
            </a>
            <a
              href="https://www.instagram.com/hotelpnsnakshatra"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram"
              className="transition-colors hover:text-white"
            >
              <Instagram className="size-4" />
            </a>
            <a
              href="tel:+917598498603"
              aria-label="Call reservations"
              className="transition-colors hover:text-white"
            >
              <Phone className="size-4" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
