"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { requestToken } from "@/app/peek-pro/client/api";
import { OdysseyLoader } from "@/app/peek-pro/main/OdysseyLoader";
import "@peektravel/app-utilities/ui/tokens.css";
import "@peektravel/app-utilities/ui/odyssey.css";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "bookings", label: "Bookings" },
  { id: "activities", label: "Activities" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    let active = true;
    requestToken()
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        // Parent never answered — stay on the loading gate.
      });
    return () => {
      active = false;
    };
  }, []);

  const activeTab = pathname?.split("/").pop() ?? "overview";

  if (!ready) {
    return (
      <>
        <OdysseyLoader />
        <p className="p-4 font-sans">Loading…</p>
      </>
    );
  }

  return (
    <>
      <OdysseyLoader />
      <main className="p-4 font-sans flex flex-col gap-4">
        <nav role="tablist" className="tab-list">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              href={`/examples/dashboard/${tab.id}`}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`tab-item tab-item--size-base${activeTab === tab.id ? " tab-item--active" : ""}`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        {children}
      </main>
    </>
  );
}
