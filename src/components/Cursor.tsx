"use client";

import { useEffect, useRef } from "react";

export function Cursor() {
  const starRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const star = starRef.current;
    if (!star) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;

      star.style.transform = `translate3d(${event.clientX}px, ${event.clientY - 10}px, 0) translate(-50%, -50%)`;
      star.style.opacity = "1";
    };
    const handlePointerLeave = () => {
      star.style.opacity = "0";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, []);

  return (
    <svg
      ref={starRef}
      className="cursor-star"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="m12 2.5 2.9 6.1 6.6.9-4.8 4.7 1.1 6.6-5.8-3.2-5.8 3.2 1.1-6.6-4.8-4.7 6.6-.9L12 2.5Z" />
    </svg>
  );
}
