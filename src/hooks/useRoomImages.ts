import { useEffect, useMemo, useState } from "react";
import { getSelectedRoomImages, roomImageRepository } from "@/services/roomImageRepository";
import type { RoomImage, RoomImageDestination, RoomType } from "@/types/roomImages";

export function useRoomImageLibrary() {
  const [images, setImages] = useState<RoomImage[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = () => {
      void roomImageRepository
        .listImages()
        .then((result) => {
          if (!mounted) return;
          setImages(result.images);
          setWarnings(result.warnings);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (!mounted) return;
          setError(reason instanceof Error ? reason.message : "Room images could not be loaded.");
        });
    };

    load();
    const intervalId = window.setInterval(load, 15000);
    const unsubscribe = roomImageRepository.subscribe(load);
    const onManagedImagesChanged = (event: Event) => {
      const collection = (event as CustomEvent<{ collection?: string }>).detail?.collection;
      if (!collection || collection === "room") load();
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

  return { images, warnings, error };
}

export function useRoomImages(destination: RoomImageDestination, roomType?: RoomType) {
  const { images, warnings, error } = useRoomImageLibrary();
  const selected = useMemo(
    () => getSelectedRoomImages(images, destination, roomType),
    [images, destination, roomType],
  );

  return { images: selected, allImages: images, warnings, error };
}
