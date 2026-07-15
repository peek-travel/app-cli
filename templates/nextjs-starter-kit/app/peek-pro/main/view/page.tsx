"use client";
import { useEffect, useState } from "react";
import { requestToken, apiFetch } from "@/app/peek-pro/client/api";
import type { Activity } from "@/app/peek-pro/client/types";

export default function SettingsViewPage() {
  const [ready, setReady] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!ready) return;
    let active = true;
    apiFetch<{ name: string }>("/peek-pro/main/api/me")
      .then((data) => {
        if (active) setUserName(data.name);
      })
      .catch(() => {
        // Non-critical — the greeting just stays hidden.
      });
    return () => {
      active = false;
    };
  }, [ready]);

  async function pullActivities() {
    setLoadingActivities(true);
    setError(null);
    try {
      const data = await apiFetch<{ activities: Activity[] }>(
        "/peek-pro/main/api/activities",
      );
      setActivities(data.activities);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoadingActivities(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center font-sans">
        <div className="flex items-center gap-3 text-gray-400">
          <ody-loading-spinner size="small" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  const buttonLabel = loadingActivities
    ? "Loading…"
    : activities
      ? ""
      : "Pull my activities";

  return (
    <main
      className="font-sans flex min-h-screen items-center justify-center p-8"
      style={{
        backgroundImage: "linear-gradient(180deg, #fdf4ff 0%, #eff6ff 100%)",
      }}
    >
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-[20px] text-3xl"
          style={{
            backgroundImage: "linear-gradient(135deg, #a78bfa, #f0abfc)",
            boxShadow: "0 16px 30px -10px rgba(168,139,250,0.6)",
          }}
        >
          ✨
        </div>

        <div className="flex flex-col gap-3">
          <h1
            className="text-[30px] font-bold leading-[1.15] tracking-tight"
            style={{ color: "#3b0764" }}
          >
            Your app is ready
          </h1>

          <p className="text-sm" style={{ color: "#7c6f9c" }}>
            Edit{" "}
            <code
              className="rounded-md px-1.5 py-0.5 text-xs"
              style={{
                background: "#fff",
                color: "#7c3aed",
                boxShadow: "0 2px 6px -2px rgba(124,58,237,0.2)",
              }}
            >
              app/peek-pro/main/view/page.tsx
            </code>{" "}
            — changes show up here right away, inside Peek Pro.
          </p>
        </div>

        <div
          className="mt-2 flex w-full flex-col gap-4 rounded-2xl p-6 text-left"
          style={{
            background: "#ffffff",
            border: "1px solid #f3e8ff",
            boxShadow: "0 14px 34px -12px rgba(124,58,237,0.25)",
          }}
        >
          {userName ? (
            <span
              className="inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-sm font-medium"
              style={{ background: "#faf5ff", color: "#6b21a8" }}
            >
              <span
                className="h-[9px] w-[9px] rounded-full"
                style={{
                  background: "#22c55e",
                  boxShadow: "0 0 0 4px rgba(34,197,94,0.18)",
                }}
              />
              Hi, {userName}!
            </span>
          ) : (
            <span className="text-sm font-medium text-gray-500">
              Authenticated session
            </span>
          )}

          <div className="flex flex-col gap-1.5">
            <p
              className="text-xs font-medium tracking-wide my-2"
              style={{ color: "#a78baf" }}
            >
              Your app has access to the backoffice API.
            </p>
            <ody-button
              variant="primary"
              onClick={pullActivities}
              disabled={loadingActivities}
            >
              {buttonLabel}
            </ody-button>
          </div>

          {error && (
            <ody-alert variant="danger" heading="Failed to load">
              {error}
            </ody-alert>
          )}

          {activities && activities.length === 0 && (
            <ody-empty-state
              variant="no-results"
              label="No activities"
              caption="No activities found for this account."
            />
          )}

          {activities && activities.length > 0 && (
            <div className="flex flex-col gap-2">
              {activities.map((a) => (
                <ody-product-indicator
                  key={a.id}
                  name={a.name}
                  bar-color={a.color ?? "var(--color-neutral-300)"}
                />
              ))}
            </div>
          )}
        </div>

        <p className="text-xs" style={{ color: "#a78baf" }}>
          See{" "}
          <code className="rounded bg-white/70 px-1.5 py-0.5">
            app/examples/dashboard
          </code>{" "}
          for a fuller example — safe to delete if you don&apos;t need it.
        </p>
      </div>
    </main>
  );
}
