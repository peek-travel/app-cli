import { z } from "zod";

const schema = z.object({
  PEEK_APP_SECRET: z.string().min(1, "PEEK_APP_SECRET is required"),
  PEEK_APP_ID: z.string().min(1, "PEEK_APP_ID is required"),
  PEEK_API_URL: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z
      .string()
      .url("PEEK_API_URL must be a full URL, e.g. https://your-app.example.com")
      .default("https://app-registry.peeklabs.com/installations-api"),
  ),
  PEEK_APP_URL: z
    .string()
    .url("PEEK_APP_URL must be a full URL, e.g. https://your-app.example.com"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(
  vars: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): Env {
  const result = schema.safeParse(vars);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    throw new Error(`Environment configuration error: ${issues}`);
  }
  return result.data;
}
