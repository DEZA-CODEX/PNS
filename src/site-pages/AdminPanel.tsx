"use client";

import {
  ArrowUpRight,
  BarChart3,
  BedDouble,
  Camera,
  Coffee,
  CreditCard,
  Gauge,
  Home,
  Image as ImageIcon,
  LogOut,
  MapPinned,
  MessageSquareText,
  Settings,
  Sparkles,
  Star,
  Utensils,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { AdminAccessManagement } from "@/admin/AdminAccessManagement";
import { DiningImageManagement } from "@/admin/DiningImageManagement";
import { RoomImageManagement } from "@/admin/RoomImageManagement";
import { authService } from "@/admin/auth/services/authService";
import type { AdminUser } from "@/lib/admin-types";

const navSections = [
  ["Dashboard", Home],
  ["Reservations", CalendarIcon],
  ["Rooms", BedDouble],
  ["Dining", Coffee],
  ["Gallery / Media", Camera],
  ["Room Image Management", ImageIcon],
  ["Dining Image Management", Utensils],
  ["Users and Groups", Users],
  ["Guest Reviews", Star],
  ["Website Content", FileTextIcon],
  ["Settings", Settings],
] as const;

const stats = [
  { label: "Total Bookings", value: "1,284", delta: "+12.4%" },
  { label: "Occupancy", value: "86%", delta: "+4.2%" },
  { label: "Revenue", value: "₹8.4L", delta: "+8.7%" },
  { label: "Available Rooms", value: "18", delta: "-3 this week" },
  { label: "Guest Reviews", value: "94", delta: "+11 new" },
  { label: "Website Views", value: "24.8K", delta: "+22.1%" },
] as const;

const revenueTrend = [
  { month: "Jan", revenue: 5.2 },
  { month: "Feb", revenue: 5.8 },
  { month: "Mar", revenue: 6.1 },
  { month: "Apr", revenue: 5.7 },
  { month: "May", revenue: 7.3 },
  { month: "Jun", revenue: 8.4 },
];

const roomBookings = [
  { room: "Deluxe", bookings: 184 },
  { room: "Premier", bookings: 142 },
  { room: "Suite", bookings: 96 },
  { room: "Family", bookings: 78 },
];

const bookingChannels = [
  { channel: "Direct", bookings: 42, color: "#051838" },
  { channel: "Travel sites", bookings: 31, color: "#cf8c55" },
  { channel: "Phone", bookings: 17, color: "#69849b" },
  { channel: "Walk-in", bookings: 10, color: "#b9cbd5" },
];

const recentActivity = [
  ["New booking", "Mr. Sharma reserved a Deluxe Room for 3 nights", "2h ago"],
  ["Check-in", "Family from Bengaluru checked into the Suite", "4h ago"],
  ["Dining update", "Cloud 9 menu refreshed for the weekend", "Today"],
  ["Review published", "Guest review from Vellore posted to the site", "1d ago"],
] as const;

const roomBreakdown = [
  { title: "Room Types", value: "8 categories" },
  { title: "Room Details", value: "Full inventory" },
  { title: "Pricing", value: "Dynamic rates" },
  { title: "Availability", value: "Live sync" },
  { title: "Images", value: "118 assets" },
] as const;

const contentModules = [
  { title: "Home", detail: "Hero, offers, promos" },
  { title: "About Us", detail: "Brand story and facilities" },
  { title: "Rooms", detail: "Room highlights and rates" },
  { title: "Dining", detail: "Restaurant experiences" },
  { title: "Contact", detail: "Location and support" },
] as const;

const sectionRows = [
  {
    label: "Reservations",
    items: ["All Reservations", "Upcoming", "Checked-in", "Completed / Cancelled"],
  },
  { label: "Dining", items: ["Vrindavan", "Cloud 9", "Clinq"] },
  {
    label: "Gallery / Media",
    items: ["All Images", "Upload Image", "Add Image URL", "Categories", "Delete / Replace"],
  },
  { label: "Guest Reviews", items: ["All Reviews", "Published", "Pending"] },
  {
    label: "Settings",
    items: ["Hotel Information", "Contact Details", "Social Links", "Admin Settings"],
  },
] as const;

function CalendarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

function FileTextIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" {...props}>
      <path d="M7 3h7l5 5v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}

export function AdminPanel({
  currentUser,
  permissions,
}: {
  currentUser: AdminUser;
  permissions: string[];
}) {
  const [activeSection, setActiveSection] = useState("Dashboard");
  const [loggingOut, setLoggingOut] = useState(false);

  return (
    <div className="admin-times-font min-h-screen bg-[var(--color-surface-cool)] text-[var(--color-text-primary)]">
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="w-full shrink-0 bg-[#051838] text-[var(--color-ivory)] md:w-[290px]">
          <div className="h-[89px] border-b border-white/10" aria-hidden="true" />

          <nav className="flex gap-1 overflow-x-auto px-3 py-3 md:block md:space-y-1 md:overflow-visible md:px-4 md:py-6">
            {navSections
              .filter(([label]) =>
                label === "Room Image Management"
                  ? permissions.includes("room_images.read")
                  : label === "Dining Image Management"
                    ? permissions.includes("dining_images.read")
                    : label === "Users and Groups"
                      ? permissions.includes("users.read") || permissions.includes("groups.read")
                      : true,
              )
              .map(([label, Icon]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    if (
                      label === "Dashboard" ||
                      label === "Room Image Management" ||
                      label === "Dining Image Management" ||
                      (label === "Users and Groups" && permissions.includes("users.read"))
                    ) {
                      setActiveSection(label);
                    }
                  }}
                  aria-current={activeSection === label ? "page" : undefined}
                  className={`flex h-12 w-auto shrink-0 items-center justify-between whitespace-nowrap rounded-xl px-3 py-3 text-left text-sm uppercase tracking-[0.12em] transition-colors md:w-full ${
                    activeSection === label
                      ? "bg-white/8 text-[var(--color-ivory)]"
                      : "text-[var(--color-ivory)]/75 hover:bg-white/5 hover:text-[var(--color-ivory)]"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-4 w-4" />
                    {label}
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 opacity-70" />
                </button>
              ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">
          <header className="mb-8 flex flex-col gap-4 border-b border-[var(--color-border-warm)] pb-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-gold)]">
                Admin Panel
              </p>
              <h1 className="mt-2 text-4xl leading-none text-[var(--color-text-primary)]">
                {activeSection}
              </h1>
              <p className="mt-2 text-sm text-[var(--color-text-primary)]/65">
                Signed in as {currentUser.displayName} · {currentUser.roleName}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {activeSection === "Dashboard" ? (
                <button className="luxury-button luxury-button-hover px-5 py-3 text-xs uppercase tracking-[0.14em]">
                  New booking
                </button>
              ) : null}
              <button
                type="button"
                disabled={loggingOut}
                onClick={async () => {
                  setLoggingOut(true);
                  const result = await authService.logout();
                  if (result.success) window.location.assign("/admin/login");
                  else setLoggingOut(false);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-warm)] px-4 py-2 text-xs uppercase tracking-[0.1em] text-[#051838] disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
                {loggingOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </header>

          {activeSection === "Room Image Management" ? <RoomImageManagement /> : null}
          {activeSection === "Dining Image Management" ? <DiningImageManagement /> : null}
          {activeSection === "Users and Groups" ? (
            <AdminAccessManagement
              permissions={permissions}
              currentUserRole={currentUser.roleName}
            />
          ) : null}
          {activeSection === "Dashboard" ? (
            <div>
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {stats.map((stat) => (
                  <article
                    key={stat.label}
                    className="rounded-2xl border border-[var(--color-border-warm)] bg-white/30 p-5 shadow-[0_18px_45px_-30px_rgba(5,24,56,0.45)] backdrop-blur-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-primary)]/70">
                        {stat.label}
                      </span>
                      <BarChart3 className="h-4 w-4 text-[var(--color-gold)]" />
                    </div>
                    <div className="mt-6 flex items-end justify-between">
                      <strong className="text-3xl font-semibold tracking-[-0.04em] text-[var(--color-text-primary)]">
                        {stat.value}
                      </strong>
                      <span className="text-sm font-medium text-[var(--color-gold)]">
                        {stat.delta}
                      </span>
                    </div>
                  </article>
                ))}
              </section>

              <section
                aria-label="Hotel performance charts"
                className="mt-8 grid gap-6 xl:grid-cols-2"
              >
                <article className="rounded-2xl border border-[var(--color-border-warm)] bg-white/50 p-5">
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
                        Revenue trend
                      </h2>
                      <p className="mt-1 text-sm text-[var(--color-text-primary)]/65">
                        Monthly revenue · ₹ lakh
                      </p>
                    </div>
                    <span className="rounded-full bg-[#051838]/5 px-3 py-1 text-xs font-medium text-[#051838]">
                      Jan – Jun
                    </span>
                  </div>
                  <div
                    className="h-[260px] w-full"
                    role="img"
                    aria-label="Area chart showing monthly revenue from January to June"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={revenueTrend}
                        margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#cf8c55" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#cf8c55" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#05183818" vertical={false} />
                        <XAxis
                          dataKey="month"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#46536b", fontSize: 12 }}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#46536b", fontSize: 12 }}
                          tickFormatter={(value: number) => `₹${value}L`}
                        />
                        <Tooltip
                          formatter={(value) => [`₹${value}L`, "Revenue"]}
                          contentStyle={{ borderRadius: 10, borderColor: "#dfe7ef" }}
                        />
                        <Area
                          type="monotone"
                          dataKey="revenue"
                          stroke="#cf8c55"
                          strokeWidth={3}
                          fill="url(#revenueFill)"
                          activeDot={{ r: 5, fill: "#051838" }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </article>

                <article className="rounded-2xl border border-[var(--color-border-warm)] bg-white/50 p-5">
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
                        Bookings by room type
                      </h2>
                      <p className="mt-1 text-sm text-[var(--color-text-primary)]/65">
                        Reservations in the current period
                      </p>
                    </div>
                    <BedDouble className="mt-1 h-5 w-5 text-[var(--color-gold)]" />
                  </div>
                  <div
                    className="h-[260px] w-full"
                    role="img"
                    aria-label="Bar chart comparing bookings across room types"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={roomBookings}
                        margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                      >
                        <CartesianGrid stroke="#05183818" vertical={false} />
                        <XAxis
                          dataKey="room"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#46536b", fontSize: 12 }}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#46536b", fontSize: 12 }}
                        />
                        <Tooltip
                          cursor={{ fill: "#05183808" }}
                          contentStyle={{ borderRadius: 10, borderColor: "#dfe7ef" }}
                        />
                        <Bar
                          dataKey="bookings"
                          name="Bookings"
                          fill="#051838"
                          radius={[5, 5, 0, 0]}
                          maxBarSize={44}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </article>

                <article className="rounded-2xl border border-[var(--color-border-warm)] bg-white/50 p-5 xl:col-span-2">
                  <div className="mb-5">
                    <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
                      Booking channels
                    </h2>
                    <p className="mt-1 text-sm text-[var(--color-text-primary)]/65">
                      Share of reservations by source
                    </p>
                  </div>
                  <div className="grid items-center gap-5 sm:grid-cols-[minmax(220px,0.8fr)_1fr]">
                    <div
                      className="h-[230px] w-full"
                      role="img"
                      aria-label="Donut chart showing reservation share by booking channel"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={bookingChannels}
                            dataKey="bookings"
                            nameKey="channel"
                            innerRadius={62}
                            outerRadius={92}
                            paddingAngle={3}
                            stroke="none"
                          >
                            {bookingChannels.map((entry) => (
                              <Cell key={entry.channel} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value, name) => [`${value}%`, name]}
                            contentStyle={{ borderRadius: 10, borderColor: "#dfe7ef" }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {bookingChannels.map((channel) => (
                        <div
                          key={channel.channel}
                          className="flex items-center justify-between rounded-xl border border-[var(--color-border-warm)] bg-white/60 px-4 py-3"
                        >
                          <span className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: channel.color }}
                            />
                            {channel.channel}
                          </span>
                          <strong className="text-sm text-[var(--color-text-primary)]">
                            {channel.bookings}%
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>
              </section>

              <section className="mt-8 grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
                <div className="rounded-2xl border border-[var(--color-border-warm)] bg-white/30 p-5 shadow-[0_18px_45px_-30px_rgba(5,24,56,0.45)]">
                  <div className="mb-5 flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
                      Recent Activity
                    </h2>
                    <button className="text-xs uppercase tracking-[0.14em] text-[var(--color-gold)]">
                      View all
                    </button>
                  </div>

                  <div className="space-y-4">
                    {recentActivity.map(([title, detail, time]) => (
                      <div
                        key={title}
                        className="flex items-start gap-3 border-b border-[var(--color-border-warm)] pb-3 last:border-b-0 last:pb-0"
                      >
                        <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-navy)] text-[var(--color-ivory)]">
                          <Sparkles className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-[var(--color-text-primary)]">{title}</p>
                          <p className="mt-1 text-sm text-[var(--color-text-primary)]/70">
                            {detail}
                          </p>
                        </div>
                        <span className="text-xs uppercase tracking-[0.12em] text-[var(--color-gold)]">
                          {time}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--color-border-warm)] bg-[#051838] p-5 text-[var(--color-ivory)] shadow-[0_18px_45px_-28px_rgba(5,24,56,0.75)]">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-xl font-semibold">Occupancy</h2>
                    <Gauge className="h-5 w-5 text-[var(--color-gold)]" />
                  </div>

                  <div className="space-y-4">
                    {["Deluxe", "Premier", "Suites", "Dining"].map((label, index) => (
                      <div key={label}>
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span>{label}</span>
                          <span className="text-[var(--color-gold)]">{72 + index * 8}%</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-[var(--color-gold)]"
                            style={{ width: `${72 + index * 8}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-[var(--color-border-warm)] bg-white/30 p-5 shadow-[0_18px_45px_-30px_rgba(5,24,56,0.45)]">
                  <div className="mb-5 flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
                      Rooms
                    </h2>
                    <BedDouble className="h-5 w-5 text-[var(--color-gold)]" />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {roomBreakdown.map((item) => (
                      <div
                        key={item.title}
                        className="rounded-xl border border-[var(--color-border-warm)] bg-[rgba(255,255,255,0.35)] p-4"
                      >
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-gold)]">
                          {item.title}
                        </p>
                        <p className="mt-3 text-base font-medium text-[var(--color-text-primary)]">
                          {item.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--color-border-warm)] bg-white/30 p-5 shadow-[0_18px_45px_-30px_rgba(5,24,56,0.45)]">
                  <div className="mb-5 flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
                      Website Content
                    </h2>
                    <FileTextIcon className="h-5 w-5 text-[var(--color-gold)]" />
                  </div>
                  <div className="space-y-3">
                    {contentModules.map((item) => (
                      <div
                        key={item.title}
                        className="flex items-center justify-between rounded-xl border border-[var(--color-border-warm)] bg-[rgba(255,255,255,0.35)] p-3"
                      >
                        <div>
                          <p className="font-medium text-[var(--color-text-primary)]">
                            {item.title}
                          </p>
                          <p className="text-xs uppercase tracking-[0.12em] text-[var(--color-text-primary)]/60">
                            {item.detail}
                          </p>
                        </div>
                        <ArrowUpRight className="h-4 w-4 text-[var(--color-gold)]" />
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {sectionRows.map((section) => (
                  <div
                    key={section.label}
                    className="rounded-2xl border border-[var(--color-border-warm)] bg-white/30 p-5 shadow-[0_18px_45px_-30px_rgba(5,24,56,0.45)]"
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                        {section.label}
                      </h3>
                      <span className="rounded-full bg-[var(--color-gold)]/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--color-gold)]">
                        Active
                      </span>
                    </div>
                    <ul className="space-y-2 text-sm text-[var(--color-text-primary)]/75">
                      {section.items.map((item) => (
                        <li
                          key={item}
                          className="flex items-center justify-between border-b border-[var(--color-border-warm)] pb-2 last:border-b-0 last:pb-0"
                        >
                          <span>{item}</span>
                          <span className="h-2 w-2 rounded-full bg-[var(--color-gold)]" />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
