import type { StaticImageData } from "next/image";
import heroHotel from "@/assets/hero-bg/hero-hotel.jpg";

type ImageModule = { default: StaticImageData };

const imagePatterns = [
  "../assets/hero-bg/*.avif",
  "../assets/hero-bg/*.gif",
  "../assets/hero-bg/*.jpeg",
  "../assets/hero-bg/*.jpg",
  "../assets/hero-bg/*.png",
  "../assets/hero-bg/*.webp",
  "../assets/hero-container-img/*.avif",
  "../assets/hero-container-img/*.gif",
  "../assets/hero-container-img/*.jpeg",
  "../assets/hero-container-img/*.jpg",
  "../assets/hero-container-img/*.png",
  "../assets/hero-container-img/*.webp",
];

const images = import.meta.glob<ImageModule>(imagePatterns, { eager: true });

function getImages(folder: "hero-bg" | "hero-container-img") {
  const folderPath = `../assets/${folder}/`;

  return Object.entries(images)
    .filter(([path]) => path.startsWith(folderPath))
    .map(([, image]) => image.default);
}

export const heroImageManifest = {
  hero_background: getImages("hero-bg"),
  hero_container: getImages("hero-container-img"),
};

export const heroHotelImage = heroHotel;
