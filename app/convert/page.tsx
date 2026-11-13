import type { Metadata } from "next";
import { ImageConverter } from "@/components/ImageConverter";

export const metadata: Metadata = {
  title: "Image to WebP Converter",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <ImageConverter />;
}
