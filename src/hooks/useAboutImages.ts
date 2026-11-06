import { useEffect, useState } from "react";

import { diningImageRepository } from "@/services/roomImageRepository";
import type { DiningImage, DiningImageLoadResult } from "@/types/roomImages";

const EMPTY_RESULT: DiningImageLoadResult = {
  images: [],
  warnings: [],
  displayCounts: {
    vrindavan: { diningPage: 1, diningHero: 1 },
    cloud9: { diningPage: 1, diningHero: 1 },
    clinq: { diningPage: 1, diningHero: 1 },
  },
};

export function useAboutImages() {
  const [result, setResult] = useState<DiningImageLoadResult>(EMPTY_RESULT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = () => {
      void diningImageRepository
        .listAboutImages()
        .then((loaded) => {
          if (!mounted) return;
          setResult(loaded);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (mounted) {
            setError(
              reason instanceof Error ? reason.message : "About images could not be loaded.",
            );
          }
        });
    };

    load();
    const intervalId = window.setInterval(load, 15000);
    const unsubscribe = diningImageRepository.subscribe(load);
    const onManagedImagesChanged = (event: Event) => {
      const collection = (event as CustomEvent<{ collection?: string }>).detail?.collection;
      if (!collection || collection === "dining") load();
    };
    const onFocus = () => load();
    window.addEventListener("pns-managed-images-changed", onManagedImagesChanged);
    window.addEventListener("focus", onFocus);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pns-managed-images-changed", onManagedImagesChanged);
      unsubscribe();
    };
  }, []);

  return {
    images: result.images as DiningImage[],
    warnings: result.warnings,
    error,
  };
}
