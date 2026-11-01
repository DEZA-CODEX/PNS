import { Facebook, Instagram, Mail, MapPin, Phone } from "lucide-react";
import logo from "@/assets/pns logo.png";
import logoWebp from "@/assets/pns-logo.webp";

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
    <footer className="site-footer dark-surface border-t border-gold/30 bg-[#051838] text-[var(--color-ivory)]">
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-y-4 px-4 py-3 sm:px-6 md:grid-cols-[0.9fr_1.1fr] md:gap-x-8 lg:grid-cols-[0.9fr_1.35fr_1.45fr] lg:items-start lg:gap-x-8 lg:px-10 lg:py-4">
        <div className="flex min-w-0 flex-col items-start">
          <a href="/" className="inline-block" aria-label="Hotel PNS Nakshatra home">
            <picture>
              <source srcSet={logoWebp.src} type="image/webp" />
              <img
                src={logo.src}
                alt="Hotel PNS Nakshatra"
                width={288}
                height={144}
                decoding="async"
                className="h-[2.1rem] w-auto object-contain"
              />
            </picture>
          </a>
          <button
            onClick={onBook}
            className="luxury-button luxury-button-hover mt-2 w-fit px-4 py-1.5 text-xs uppercase tracking-[0.14em]"
          >
            Book your stay
          </button>
        </div>

        <div className="min-w-0">
          <p className="eyebrow text-gold">Explore</p>
          <nav
            aria-label="Footer primary"
            className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-5 text-[var(--color-ivory)]/85"
          >
            {navigation.map(([label, href]) => (
              <a key={href} href={href} className="transition-colors hover:text-gold">
                {label}
              </a>
            ))}
          </nav>
        </div>

        <div className="min-w-0 md:col-span-2 lg:col-span-1">
          <p className="eyebrow text-gold">Contact</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm leading-5 text-[var(--color-ivory)]/85">
            <a
              href="tel:+917598498603"
              className="inline-flex items-center gap-1 transition-colors hover:text-gold"
            >
              <Phone className="size-3.5 shrink-0 text-gold" />
              Room reservations: +91 75984 98603
            </a>
            <a href="tel:04162266111" className="transition-colors hover:text-gold">
              Phone: 0416 2266111 / 0416 2266222
            </a>
            <a
              href="mailto:fo@hotelpnsnakshatra.com"
              className="inline-flex items-center gap-1 break-all transition-colors hover:text-gold"
            >
              <Mail className="size-3.5 shrink-0 text-gold" />
              fo@hotelpnsnakshatra.com
            </a>
            <a
              href="https://maps.app.goo.gl/MhVVYxgfvEiwWW6d8"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-gold transition-colors hover:text-[var(--color-ivory)] lg:basis-full xl:basis-auto"
            >
              <MapPin className="size-3.5" />
              Get directions
            </a>
          </div>
        </div>
      </div>

      <div className="border-t border-gold/20">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-x-5 gap-y-2 px-4 py-2 text-[0.65rem] uppercase tracking-[0.1em] text-[var(--color-ivory)]/70 sm:px-6 md:flex-row md:flex-wrap md:items-center md:justify-between md:pl-6 md:pr-24 lg:pl-10 lg:pr-24">
          <span>© {new Date().getFullYear()} Hotel PNS Nakshatra</span>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
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
          <div className="flex items-center gap-4 text-gold">
            <a
              href="https://www.facebook.com/pnsnakshatra"
              target="_blank"
              rel="noreferrer"
              aria-label="Facebook"
              className="transition-colors hover:text-[var(--color-ivory)]"
            >
              <Facebook className="size-4" />
            </a>
            <a
              href="https://www.instagram.com/hotelpnsnakshatra"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram"
              className="transition-colors hover:text-[var(--color-ivory)]"
            >
              <Instagram className="size-4" />
            </a>
            <a
              href="tel:+917598498603"
              aria-label="Call reservations"
              className="transition-colors hover:text-[var(--color-ivory)]"
            >
              <Phone className="size-4" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
