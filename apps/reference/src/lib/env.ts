import { z } from "zod";

/**
 * Environment access, validated once at module load.
 *
 * The point of parsing rather than reading `import.meta.env` inline is that a
 * missing or malformed variable fails immediately and loudly at boot, instead
 * of surfacing later as a confusing runtime error deep inside the Supabase
 * client.
 */

const clientSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const parsed = clientSchema.safeParse({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});

if (!parsed.success) {
  throw new Error(
    `Invalid client environment — copy .env.example to .env.\n${z.prettifyError(parsed.error)}`,
  );
}

/** Safe to reference from both server and browser code. */
export const clientEnv = parsed.data;

export const isProduction = import.meta.env.PROD;
