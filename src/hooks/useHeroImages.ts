"use client";

import { heroImageManifest } from "@/data/imageManifest";

export type HeroImageKind = "hero_background" | "hero_container";
export type HeroImageSlide = { src: string; alt: string };

const descriptions: Record<string, string> = {
  "hero-hotel": "Hotel PNS Nakshatra illuminated at night",
  "hero-hotel1": "Hotel PNS Nakshatra guest room",
  image: "Hotel PNS Nakshatra exterior",
  "pns logo": "Hotel PNS Nakshatra logo",
};

export function useHeroImages(kind: HeroImageKind): HeroImageSlide[] {
  return heroImageManifest[kind].map((image) => ({
    src: image.src,
    alt:
      descriptions[
        image.src
          .split("/")
          .pop()
          ?.replace(/\.[^.]+$/, "") ?? ""
      ] ?? "Hotel PNS Nakshatra",
  }));
}
