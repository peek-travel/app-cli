// The tech stacks a Peek app can be built on. `value` keys the skill composition
// (src/skills/stack/<value>/*) and, later, which starter kit is scaffolded; `label` is what
// we show the developer. Only JavaScript exists today — the sole starter kit is JS/Next.js.
export const STACKS = [
  { value: "javascript", label: "JavaScript" },
] as const;

export type StackValue = (typeof STACKS)[number]["value"];

export const STACK_VALUES = STACKS.map((st) => st.value);

// Human label for a stack value, falling back to the raw value for anything not yet labeled.
export function stackLabel(value: string): string {
  return STACKS.find((st) => st.value === value)?.label ?? value;
}
