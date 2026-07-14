// The platforms a Peek app can target. `value` is the key the registry and the starter
// kit use (manifest file app.<value>.json, ?platform=<value> query param); `label` is
// what we show the developer. Shared by `peek init` and the `peek extensions` commands.
export const PLATFORMS = [
  { value: "peek", label: "Peek" },
  { value: "acme", label: "ACME" },
  { value: "cng", label: "Connectngo" },
] as const;

export type PlatformValue = (typeof PLATFORMS)[number]["value"];

export const PLATFORM_VALUES = PLATFORMS.map((pl) => pl.value);

// Human label for a platform value, falling back to the raw value for anything the
// registry knows about but this CLI hasn't been taught a label for.
export function platformLabel(value: string): string {
  return PLATFORMS.find((pl) => pl.value === value)?.label ?? value;
}
