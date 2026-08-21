import { isValidSlug, slugify } from "~/lib/slug";
import type { AuthContext } from "../context";
import { conflict } from "../errors";

/**
 * Organization creation.
 *
 * Deliberately thin: the database already owns every invariant that matters.
 * The slug shape is a check constraint, uniqueness is a unique index, and the
 * `organizations_add_owner` trigger is what makes the creator an owner. This
 * function's only real jobs are to derive a usable slug and to translate the
 * two failures a user can actually cause into the error vocabulary.
 *
 * One subtlety: the trigger fires `when (new.created_by is not null)`, so
 * omitting `created_by` would insert an organization that nobody belongs to —
 * unreachable through RLS from that moment on. It is set explicitly below.
 */

export interface CreatedOrg {
  id: string;
  slug: string;
  name: string;
}

export async function createOrg(
  ctx: AuthContext,
  input: { name: string; slug?: string },
): Promise<CreatedOrg> {
  const name = input.name.trim();
  const slug = (input.slug?.trim() || slugify(name)).toLowerCase();

  if (!isValidSlug(slug)) {
    throw conflict(
      "That name does not produce a usable URL. Use 3–48 characters: letters, numbers and hyphens.",
    );
  }

  // Deliberately no .select() on the insert.
  //
  // PostgREST turns .select() into INSERT ... RETURNING, and RETURNING output is
  // subject to the *read* policy — "orgs: members can read", which requires a
  // membership. The membership is produced by the organizations_add_owner AFTER
  // INSERT trigger, which has not fired at the point RETURNING is evaluated, so
  // the row comes back unreadable and the whole statement is refused. Reading it
  // back in a second statement works, because by then the trigger has run.
  const { error } = await ctx.db
    .from("organizations")
    .insert({ name, slug, created_by: ctx.userId });

  if (error) {
    // 23505 is unique_violation — the slug is taken. Reported as a conflict
    // because it is the one insert failure the caller can fix themselves.
    if (error.code === "23505") {
      throw conflict(`The URL "${slug}" is already taken. Choose another.`);
    }
    throw new Error(`createOrg: ${error.message}`);
  }

  // Now readable: the trigger made the caller an owner. Scoped by created_by as
  // well as slug so this can only ever return the row we just wrote.
  const { data, error: readError } = await ctx.db
    .from("organizations")
    .select("id, slug, name")
    .eq("slug", slug)
    .eq("created_by", ctx.userId)
    .single();

  if (readError) throw new Error(`createOrg/read-back: ${readError.message}`);

  return { id: data.id, slug: data.slug, name: data.name };
}
