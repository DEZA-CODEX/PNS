import type { RoomType } from "@/types/roomImages";

export type Room = {
  id: RoomType;
  name: string;
  category: string;
  description: string;
  amenities: string[];
  price: string;
  tax: string;
  detailsUrl: string;
};

export const roomCategories: Room[] = [
  {
    id: "vajra",
    name: "Vajra",
    category: "Premium Rooms",
    description:
      "Our Vajra Premium Rooms are designed to provide a serene and sophisticated environment for our guests.",
    amenities: [
      "Centralized air conditioning",
      "32” LED TV",
      "Mini fridge",
      "In-room dining service",
    ],
    price: "₹4,500",
    tax: "5% GST",
    detailsUrl: "https://hotelpnsnakshatra.com/premium-room/",
  },
  {
    id: "garuda",
    name: "Garuda",
    category: "Luxury Rooms",
    description:
      "Our Garuda Luxury Rooms offer a blend of opulence and comfort, perfect for guests seeking a more spacious and luxurious experience.",
    amenities: [
      "Centralized air conditioning",
      "32” LED TV ",
      "24-hour hot water shower",
      "Electronic safety locker",
    ],
    price: "₹4,800",
    tax: "5% GST",
    detailsUrl: "https://hotelpnsnakshatra.com/luxury-rooms",
  },
  {
    id: "arohana",
    name: "Arohana",
    category: "Balcony Rooms",
    description:
      "The Arohana Balcony Rooms are designed for guests who appreciate the beauty of nature and desire a tranquil retreat.",
    amenities: [
      "Centralized air conditioning",
      "32” LED TV",
      "Office desk and chair",
      "high-speed Wi-Fi",
    ],
    price: "₹5,100",
    tax: "5% GST",
    detailsUrl: "https://hotelpnsnakshatra.com/balcony-rooms-in-vellore/",
  },
  {
    id: "madhurya",
    name: "Madhurya",
    category: "Junior Suite",
    description:
      "Our Madhurya Junior Suites are perfect for guests seeking a more spacious and luxurious accommodation.",
    amenities: [
      "Office desk and chair",
      "Bath kit and self-care kit",
      "In-room dining service",
      "Electronic safety locker",
    ],
    price: "₹5,400",
    tax: "5% GST",
    detailsUrl: "https://hotelpnsnakshatra.com/junior-suite-in-vellore/",
  },
  {
    id: "maayukha",
    name: "Maayukha",
    category: "Suite Rooms",
    description:
      "The Maayukha Suite Rooms are the epitome of luxury and sophistication. These expansive suites are designed to provide the ultimate in comfort and style, with a range of premium amenities and personalized services.",
    amenities: [
      "Electronic safety locker",
      "Office desk and chair",
      "Centralized air conditioning",
      "43” LED TV",
    ],
    price: "₹6,700",
    tax: "5% GST",
    detailsUrl: "https://hotelpnsnakshatra.com/suite-rooms-in-vellore/",
  },
];

export const comparisonAmenities = [
  "Centralized air conditioning",
  "LED TV",
  " high-speed Wi-Fi",
  "Mini fridge",
  "In-room dining service",
  "Electronic safety locker",
  "Office desk and chair",
  "Balcony",
  "Suite experience",
];

export function hasAmenity(room: Room, amenity: string) {
  if (amenity === "LED TV with DTH connection")
    return room.amenities.some((item) => item.includes("LED TV"));
  if (amenity === "Suite experience") return room.category.includes("Suite");
  if (amenity === "Balcony") return room.category.includes("Balcony");
  return room.amenities.includes(amenity);
}
