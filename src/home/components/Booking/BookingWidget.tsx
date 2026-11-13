"use client";

import { useState } from "react";
import {
  BedDouble,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  Minus,
  PawPrint,
  Plus,
  UserRound,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type BookingDetails = {
  destination: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
  travelingForWork: boolean;
  travelingWithPets: boolean;
};

const initialBookingDetails: BookingDetails = {
  destination: "",
  checkIn: "",
  checkOut: "",
  adults: 2,
  children: 0,
  rooms: 1,
  travelingForWork: false,
  travelingWithPets: false,
};

const maxOccupancyCount = 10;

export function BookingWidget({
  onBook,
  showHeading = false,
}: {
  onBook: (details: BookingDetails) => void;
  showHeading?: boolean;
}) {
  const [details, setDetails] = useState(initialBookingDetails);
  const [occupancyOpen, setOccupancyOpen] = useState(false);

  const updateDetails = <K extends keyof BookingDetails>(field: K, value: BookingDetails[K]) => {
    setDetails((current) => ({ ...current, [field]: value }));
  };

  const adjustCount = (field: "adults" | "children" | "rooms", amount: number) => {
    setDetails((current) => ({
      ...current,
      [field]: Math.max(
        field === "children" ? 0 : 1,
        Math.min(maxOccupancyCount, current[field] + amount),
      ),
    }));
  };

  const occupancySummary = `${details.adults} ${details.adults === 1 ? "adult" : "adults"} · ${details.children} ${details.children === 1 ? "child" : "children"} · ${details.rooms} ${details.rooms === 1 ? "room" : "rooms"}`;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onBook(details);
      }}
      aria-label={showHeading ? "Book your stay" : undefined}
      className="booking-bar glass-panel relative z-20 grid w-full grid-cols-1 gap-2 rounded-xl border-2 border-gold p-2 shadow-[0_16px_40px_-24px_rgba(41,56,99,0.55)] transition-shadow duration-300 hover:shadow-[0_20px_46px_-24px_rgba(41,56,99,0.65)] md:grid-cols-[1fr_1.2fr_1.2fr_auto] md:items-stretch"
    >
      {showHeading && (
        <h2 className="booking-bar-heading col-span-full w-full px-4 pb-2 pt-3 font-display text-3xl leading-none text-ink md:text-4xl">
          Book your stay
        </h2>
      )}

      <label className="flex min-w-0 items-center gap-3 rounded-lg px-4 py-3 transition-colors hover:bg-white/60 focus-within:bg-white/60">
        <BedDouble className="size-6 shrink-0 text-gold" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="eyebrow block">Enter destination</span>
          <input
            required
            type="text"
            autoComplete="off"
            placeholder="Where are you going?"
            value={details.destination}
            onChange={(event) => updateDetails("destination", event.target.value)}
            className="mt-0.5 w-full truncate border-0 bg-transparent p-0 text-sm text-navy outline-none placeholder:text-navy/70 focus:ring-0"
          />
        </span>
      </label>

      <fieldset className="flex min-w-0 items-center gap-3 rounded-lg border-y border-navy/10 px-4 py-3 md:border-x md:border-y-0">
        <legend className="sr-only">Select dates</legend>
        <CalendarDays className="size-6 shrink-0 text-gold" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <span className="eyebrow block">Select dates</span>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-navy sm:text-sm">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Check-in date</span>
              <input
                required
                aria-label="Check-in date"
                type="date"
                max={details.checkOut || undefined}
                value={details.checkIn}
                onChange={(event) => {
                  const checkIn = event.target.value;
                  setDetails((current) => ({
                    ...current,
                    checkIn,
                    checkOut:
                      current.checkOut && current.checkOut < checkIn ? "" : current.checkOut,
                  }));
                }}
                className="w-full min-w-0 border-0 bg-transparent p-0 text-xs text-navy outline-none focus:ring-0 sm:text-sm"
              />
            </label>
            <span aria-hidden="true" className="shrink-0 text-gold">
              —
            </span>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Check-out date</span>
              <input
                required
                aria-label="Check-out date"
                type="date"
                min={details.checkIn || undefined}
                value={details.checkOut}
                onChange={(event) => updateDetails("checkOut", event.target.value)}
                className="w-full min-w-0 border-0 bg-transparent p-0 text-xs text-navy outline-none focus:ring-0 sm:text-sm"
              />
            </label>
          </div>
        </div>
      </fieldset>

      <Popover open={occupancyOpen} onOpenChange={setOccupancyOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Select occupancy: ${occupancySummary}`}
            className="flex min-w-0 items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-white/60 focus-visible:bg-white/60"
          >
            <UserRound className="size-6 shrink-0 text-gold" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="eyebrow block">Select occupancy</span>
              <span className="mt-0.5 block truncate text-sm text-gold">{occupancySummary}</span>
            </span>
            <ChevronDown
              className={`size-4 shrink-0 text-gold transition-transform ${occupancyOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={10}
          className="w-[min(90vw,24rem)] rounded-xl border border-navy/15 bg-background p-5 text-navy shadow-xl"
        >
          <div className="space-y-4">
            {(
              [
                ["adults", "Adults", 1],
                ["children", "Children", 0],
                ["rooms", "Rooms", 1],
              ] as const
            ).map(([field, label, minimum]) => (
              <div key={field} className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-gold">{label}</span>
                <div className="flex items-center gap-4 rounded-md border border-gold/60 px-2 py-1">
                  <button
                    type="button"
                    aria-label={`Decrease ${label.toLowerCase()}`}
                    disabled={details[field] <= minimum}
                    onClick={() => adjustCount(field, -1)}
                    className="rounded p-1 text-gold transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:text-gold/30"
                  >
                    <Minus className="size-4" aria-hidden="true" />
                  </button>
                  <span
                    className="w-5 text-center text-sm tabular-nums text-gold"
                    aria-live="polite"
                  >
                    {details[field]}
                  </span>
                  <button
                    type="button"
                    aria-label={`Increase ${label.toLowerCase()}`}
                    disabled={details[field] >= maxOccupancyCount}
                    onClick={() => adjustCount(field, 1)}
                    className="rounded p-1 text-gold transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:text-gold/30"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}

            <div className="space-y-3 border-t border-navy/10 pt-4">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="inline-flex items-center gap-2 text-navy">
                  <BriefcaseBusiness className="size-4 text-gold" aria-hidden="true" />
                  Traveling for work?
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-label="Traveling for work"
                  aria-checked={details.travelingForWork}
                  onClick={() => updateDetails("travelingForWork", !details.travelingForWork)}
                  className="relative h-6 w-11 shrink-0 rounded-full bg-gold"
                >
                  <span
                    className={`absolute left-1 top-1 size-4 rounded-full bg-black transition-transform ${details.travelingForWork ? "translate-x-5" : ""}`}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="inline-flex items-center gap-2 text-navy">
                  <PawPrint className="size-4 text-gold" aria-hidden="true" />
                  Traveling with pets?
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-label="Traveling with pets"
                  aria-checked={details.travelingWithPets}
                  onClick={() => updateDetails("travelingWithPets", !details.travelingWithPets)}
                  className="relative h-6 w-11 shrink-0 rounded-full bg-gold"
                >
                  <span
                    className={`absolute left-1 top-1 size-4 rounded-full bg-black transition-transform ${details.travelingWithPets ? "translate-x-5" : ""}`}
                  />
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOccupancyOpen(false)}
              className="luxury-button luxury-button-hover w-full px-5 py-2.5"
            >
              Apply
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <button
        type="submit"
        className="luxury-button luxury-button-hover w-full px-5 py-3 md:w-auto md:self-stretch"
      >
        Book now
      </button>
    </form>
  );
}
