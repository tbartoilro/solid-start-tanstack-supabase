/**
 * URL slug derivation.
 *
 * Lives in `lib` rather than beside the organization service because both the
 * server (authoritative, in services/orgs.ts) and the browser (live preview, in
 * routes/new-org.tsx) need it, and because keeping it free of any server import
 * is what makes it unit-testable without a database or a request.
 */

/**
 * Mirrors the database's own constraint:
 *
 *   slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'
 *
 * Note the shape implies a minimum length of 3 — a one or two character slug
 * cannot satisfy it. Validation stays a check constraint; this is only how the
 * application avoids offering a slug the database will refuse.
 */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

/** Whether `value` would be accepted by the database's slug constraint. */
export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/**
 * Best-effort slug from a display name.
 *
 * Accents are decomposed and stripped so "Ünïcorn" yields "unicorn" rather than
 * dropping the letters entirely. Runs of anything else collapse to a single
 * hyphen, and leading/trailing hyphens are removed — including any left behind
 * by truncating to the column's 48-character ceiling.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}
