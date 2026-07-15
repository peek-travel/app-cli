"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/app/peek-pro/client/api";
import type { DashboardStats } from "./types";

/** Loads and renders the dashboard stat summary. Owns its own data fetch. */
export function StatsSection() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setStats(await apiFetch<DashboardStats>("/examples/dashboard/api/dashboard"));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <ody-loading-spinner />
      </div>
    );
  }

  if (error) {
    return (
      <ody-alert variant="danger" heading="Failed to load">
        {error}
      </ody-alert>
    );
  }

  if (!stats) return null;

  return (
    <ody-stat-summary>
      <ody-stat label="Activities" value={String(stats.activitiesCount)} />
      <ody-stat
        label="Today"
        value={String(stats.todayBookings.count)}
        tone={stats.todayBookings.count > 0 ? "success" : "default"}
        sub={
          stats.todayBookings.canceledCount > 0
            ? `${stats.todayBookings.canceledCount} canceled`
            : undefined
        }
      />
      <ody-stat
        label="This Week"
        value={String(stats.weekBookings.count)}
        sub={`$${stats.weekBookings.revenue}`}
      />
    </ody-stat-summary>
  );
}
