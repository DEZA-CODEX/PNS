import { facilities } from "@/home/data/homeData";
export function Amenities() {
  return (
    <section className="border-y border-border bg-[var(--color-surface-blue-soft)] px-6 py-24 lg:px-12 lg:py-32">
      <div className="mx-auto max-w-[1400px]">
        <div className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {facilities.map((item) => (
            <div
              key={item.name}
              className="group bg-background p-8 transition-colors hover:bg-card"
              data-home-reveal
            >
              <p className="font-display text-3xl text-cream group-hover:text-gold">{item.name}</p>
              <div className="gold-rule my-5 w-12" />
              <p className="text-sm text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
