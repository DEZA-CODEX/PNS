"use client";

import { useEffect, useState } from "react";
import { apiFetch, apiResourceUrl } from "@/lib/api-client";

export type HeroImageKind = "hero_background" | "hero_container";
export type HeroImageSlide = { src: string; alt: string };

type HeroRecord = {
  id: string;
  filename: string | null;
  url: string;
  active: boolean;
  selections: Record<string, boolean>;
};

type HomepageImagePayload = {
  images?: {
    hero?: Record<string, HeroRecord[]>;
  };
};

const descriptions: Record<string, string> = {
  "hero-hotel": "Hotel PNS Nakshatra illuminated at night",
  "hero-hotel1": "Hotel PNS Nakshatra guest room",
  image: "Hotel PNS Nakshatra exterior",
  "pns logo": "Hotel PNS Nakshatra logo",
};

export function useHeroImages(kind: HeroImageKind): HeroImageSlide[] {
  const [slides, setSlides] = useState<HeroImageSlide[]>([]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const response = await apiFetch("/images/homepage");
        if (!response.ok) throw new Error("Homepage images could not be loaded.");
        const payload = (await response.json()) as HomepageImagePayload;
        const selection = kind === "hero_background" ? "heroBackground" : "heroContainer";
        const records = (payload.images?.hero?.[kind] ?? []).filter(
          (image) => image.active && image.selections?.[selection] === true,
        );
        if (!mounted) return;
        setSlides(
          records
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((image) => {
              const filename = image.filename ?? "";
              const label = filename.replace(/\.[^.]+$/, "");
              return {
                src: apiResourceUrl(image.url),
                alt: descriptions[label] ?? label.replace(/[-_]+/g, " "),
              };
            }),
        );
      } catch {
        if (mounted) setSlides([]);
      }
    };

    void load();
    const onChanged = () => void load();
    window.addEventListener("pns-managed-images-changed", onChanged);
    window.addEventListener("focus", onChanged);
    return () => {
      mounted = false;
      window.removeEventListener("pns-managed-images-changed", onChanged);
      window.removeEventListener("focus", onChanged);
    };
  }, [kind]);

  return slides;
}
