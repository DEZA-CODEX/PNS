import type { Metadata } from "next";
import favicon from "@/assets/fav-icon.webp";
import ClientExtras from "./client-extras";
import "./../src/styles.css";

const siteUrl = process.env["SITE_URL"] ?? "https://hotelpnsnakshatra.com";
const description =
  "Premium rooms, rooftop dining and banquet halls at Hotel PNS Nakshatra, Vellore.";
const hotelStructuredData = {
  "@context": "https://schema.org",
  "@type": "Hotel",
  name: "Hotel PNS Nakshatra",
  description,
  url: siteUrl,
  telephone: "+91 416 222 2222",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Katpadi Road",
    addressLocality: "Vellore",
    addressRegion: "Tamil Nadu",
    postalCode: "632004",
    addressCountry: "IN",
  },
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Hotel PNS Nakshatra",
    template: "%s | Hotel PNS Nakshatra",
  },
  description,
  applicationName: "Hotel PNS Nakshatra",
  authors: [{ name: "Hotel PNS Nakshatra" }],
  icons: { icon: favicon.src },
  openGraph: {
    type: "website",
    siteName: "Hotel PNS Nakshatra",
    title: "Hotel PNS Nakshatra — Luxury Hotel in Vellore",
    description,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Hotel PNS Nakshatra — Luxury Hotel in Vellore",
    description,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(hotelStructuredData) }}
        />
        {children}
        <ClientExtras />
      </body>
    </html>
  );
}
