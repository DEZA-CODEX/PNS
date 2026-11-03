import { useEffect, useMemo, useState } from "react";
import { diningImageRepository, getSelectedDiningImages } from "@/services/roomImageRepository";
import type {
  DiningImage,
  DiningImageDestination,
  DiningImageLoadResult,
  DiningType,
} from "@/types/roomImages";

const EMPTY_RESULT: DiningImageLoadResult = {
  images: [],
  warnings: [],
  displayCounts: {
    vrindavan: { diningPage: 1, diningHero: 1 },
    cloud9: { diningPage: 1, diningHero: 1 },
    clinq: { diningPage: 1, diningHero: 1 },
  },
};

export function useDiningImageLibrary() {
  const [result, setResult] = useState<DiningImageLoadResult>(EMPTY_RESULT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = () => {
      void diningImageRepository
        .listImages()
        .then((loaded) => {
          if (!mounted) return;
          setResult(loaded);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (mounted) {
            setError(
              reason instanceof Error ? reason.message : "Dining images could not be loaded.",
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
      unsubscribe();
      window.removeEventListener("pns-managed-images-changed", onManagedImagesChanged);
    };
  }, []);

  return { ...result, error };
}

export function useDiningImages(destination: DiningImageDestination, diningType?: DiningType) {
  const { images, warnings, displayCounts, error } = useDiningImageLibrary();
  const selected = useMemo(
    () => getSelectedDiningImages(images, destination, diningType),
    [images, destination, diningType],
  );
  return {
    images: selected,
    allImages: images as DiningImage[],
    warnings,
    displayCounts,
    error,
  };
}
