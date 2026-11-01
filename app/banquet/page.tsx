import { Banquet } from "@/site-pages/Banquet";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Banquet & Events",
  description:
    "Discover elegant spaces for weddings, gatherings, meetings and celebrations at Hotel PNS Nakshatra in Vellore.",
  path: "/banquet",
});

export default function Page() {
  return <Banquet />;
}
