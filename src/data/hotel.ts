import roomDeluxe from "@/assets/room-deluxe.jpg";
import roomSuite from "@/assets/room-suite.jpg";
import roomPremier from "@/assets/room-premier.jpg";
import eventsBanquet from "@/assets/events-banquet.jpg";

export const rooms = [
  {
    id: "deluxe",
    name: "Deluxe Room",
    image: roomDeluxe.src,
    size: "280 sq.ft",
    detail:
      "Warm interiors, plush bedding and a quiet corner to unwind after a long day in Vellore.",
    amenities: ["King bed", "Rain shower", "Smart TV", "24/7 service"],
  },
  {
    id: "premier",
    name: "Premier Room",
    image: roomPremier.src,
    size: "340 sq.ft",
    detail:
      "Floor-to-ceiling windows framing the city skyline at dusk, with a dedicated work desk.",
    amenities: ["City view", "Work desk", "Mini bar", "Lounge access"],
  },
  {
    id: "suite",
    name: "Nakshatra Suite",
    image: roomSuite.src,
    size: "520 sq.ft",
    detail: "A separate living lounge, curated lighting and space enough for family or long stays.",
    amenities: ["Living lounge", "Butler service", "Breakfast", "Late checkout"],
  },
];

export const dining = [
  {
    id: "vrindavan",
    name: "Vrindavan",
    tag: "Pure Vegetarian",
    line: "The taste of tradition",
    detail:
      "South Indian classics and North Indian thalis served in brass, from early filter coffee to late dinner.",
  },
  {
    id: "cloud9",
    name: "Cloud 9",
    tag: "Rooftop Dining",
    line: "Dine above the city",
    detail:
      "Vellore's skyline unfolds beneath open-air tables, string lights and a menu that moves from grill to global.",
  },
  {
    id: "clinq",
    name: "Clinq",
    tag: "Lounge & Bar",
    line: "Unwind. Connect. Experience.",
    detail:
      "Low light, slow music and a bar built for conversation — the darkest, calmest corner of the hotel.",
  },
];

export const eventHalls = [
  { name: "Tamara", capacity: "600 guests", use: "Weddings & receptions" },
  { name: "Tavisha", capacity: "300 guests", use: "Engagements & socials" },
  { name: "Tvasista", capacity: "150 guests", use: "Conferences" },
  { name: "Titiksha", capacity: "60 guests", use: "Board meetings" },
];

export const nearby = [
  { place: "CMC Vellore", distance: "2.4 km" },
  { place: "VIT University", distance: "8.1 km" },
  { place: "Vellore Fort", distance: "6.9 km" },
  { place: "Golden Temple, Sripuram", distance: "11.2 km" },
];

export const eventsImage = eventsBanquet.src;
