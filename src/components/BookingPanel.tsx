import type { BookingDetails } from "@/home/components/Booking/BookingWidget";
import { useDialogAccessibility } from "@/hooks/useDialogAccessibility";

export function BookingPanel({
  open,
  details,
  onClose,
}: {
  open: boolean;
  details: BookingDetails;
  onClose: () => void;
}) {
  const dialogRef = useDialogAccessibility(open, onClose);

  return (
    <div
      className={`fixed inset-0 z-[80] transition-opacity duration-500 ${
        open ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!open}
      inert={!open}
    >
      <button
        aria-label="Close booking"
        onClick={onClose}
        className="absolute inset-0 backdrop-blur-sm"
        style={{ backgroundColor: "#4169E1", opacity: 0.72 }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-title"
        tabIndex={-1}
        className={`glass-panel absolute left-1/2 top-1/2 w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2 p-8 transition-transform duration-500 sm:p-12 ${
          open ? "scale-100" : "scale-95"
        }`}
      >
        <p className="eyebrow">Reserve</p>
        <h2 id="booking-title" className="mt-3 font-display text-4xl text-cream">
          Reserve your stay
        </h2>
        <div className="gold-rule mt-6" />

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <p className="eyebrow">Destination</p>
            <p className="mt-2 text-cream">{details.destination || "Not selected"}</p>
          </div>
          <div>
            <p className="eyebrow">Dates</p>
            <p className="mt-2 text-cream">
              {details.checkIn || "Check-in"} — {details.checkOut || "Check-out"}
            </p>
          </div>
          <div>
            <p className="eyebrow">Select occupancy</p>
            <p className="mt-2 text-cream">
              {details.adults} {details.adults === 1 ? "adult" : "adults"} · {details.children}{" "}
              {details.children === 1 ? "child" : "children"} · {details.rooms}{" "}
              {details.rooms === 1 ? "room" : "rooms"}
            </p>
          </div>
          <div>
            <p className="eyebrow">Preferences</p>
            <p className="mt-2 text-cream">
              {details.travelingForWork ? "Business travel" : "Leisure"} ·{" "}
              {details.travelingWithPets ? "Traveling with pets" : "No pets"}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="luxury-button luxury-button-hover mt-8 w-full px-8 py-4"
        >
          Check availability
        </button>

        <button onClick={onClose} className="eyebrow mt-6 block hover:text-gold">
          Close
        </button>
      </div>
    </div>
  );
}
