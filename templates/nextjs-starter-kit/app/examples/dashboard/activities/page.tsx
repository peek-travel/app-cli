"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/app/peek-pro/client/api";
import type { Activity } from "@/app/peek-pro/client/types";

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetch<{ activities: Activity[] }>("/peek-pro/main/api/activities");
        setActivities(data.activities);
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

  if (activities.length === 0) {
    return (
      <ody-empty-state
        variant="no-results"
        label="No activities"
        caption="No activities found for this account."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {activities.map((a) => (
        <ody-product-indicator
          key={a.id}
          name={a.name}
          bar-color={a.color ?? "var(--color-neutral-300)"}
        />
      ))}
    </div>
  );
}
