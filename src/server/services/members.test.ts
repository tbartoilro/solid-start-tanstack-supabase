import { describe, expect, it } from "vitest";
import type { AppRole } from "~/lib/auth";
import { AppError } from "../errors";
import { assertCanAssignRole } from "./members";

/**
 * The escalation matrix is a security rule, and it is pure — no database, no
 * request — so it is exhaustively testable. Every actor/target pair is asserted
 * rather than a sample, because the interesting case is the one nobody thought
 * to write by hand.
 */
const ROLES: AppRole[] = ["viewer", "member", "admin", "owner"];
const RANK: Record<AppRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

const attempt = (actor: AppRole, target: AppRole) => {
  try {
    assertCanAssignRole(actor, target);
    return "allowed" as const;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("forbidden");
    return "refused" as const;
  }
};

describe("assertCanAssignRole", () => {
  it.each(
    ROLES.flatMap((actor) =>
      ROLES.map((target) => ({
        actor,
        target,
        expected: RANK[target] <= RANK[actor] ? "allowed" : "refused",
      })),
    ),
  )("$actor granting $target is $expected", ({ actor, target, expected }) => {
    expect(attempt(actor, target)).toBe(expected);
  });

  it("refuses the specific escalation that matters: admin minting an owner", () => {
    // An admin legitimately holds members.manage, so permission checks alone
    // would let this through. This rule is what stops it.
    expect(attempt("admin", "owner")).toBe("refused");
  });

  it("lets an owner grant owner, so co-owners remain possible", () => {
    expect(attempt("owner", "owner")).toBe("allowed");
  });

  it("never lets a viewer or member grant anything above themselves", () => {
    expect(attempt("viewer", "member")).toBe("refused");
    expect(attempt("member", "admin")).toBe("refused");
  });
});
