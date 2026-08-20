import { describe, expect, it } from "vitest";
import { activeOrg, can, findOrgBySlug, type Session } from "./auth";

const session: Session = {
  user: { id: "u1", email: "a@example.test", fullName: "A", avatarUrl: null },
  orgs: [
    {
      id: "org-a",
      slug: "acme",
      name: "Acme",
      role: "member",
      permissions: ["projects.read", "issues.read", "issues.write"],
    },
    {
      id: "org-b",
      slug: "globex",
      name: "Globex",
      role: "owner",
      permissions: ["projects.read", "projects.delete", "org.settings"],
    },
  ],
  activeOrgId: "org-a",
};

describe("can", () => {
  it("grants a permission the user holds in that org", () => {
    expect(can(session, "org-a", "issues.write")).toBe(true);
  });

  it("refuses a permission the user lacks in that org", () => {
    expect(can(session, "org-a", "projects.delete")).toBe(false);
  });

  it("scopes permissions per organization, not globally", () => {
    // The same user is an owner in org-b and a member in org-a. A permission
    // held in one must not leak into the other — this is the single most
    // important property of the whole multi-tenant model.
    expect(can(session, "org-b", "projects.delete")).toBe(true);
    expect(can(session, "org-a", "projects.delete")).toBe(false);
  });

  it("refuses for an org the user is not a member of", () => {
    expect(can(session, "org-unknown", "projects.read")).toBe(false);
  });

  it("refuses when there is no session or no org", () => {
    expect(can(null, "org-a", "projects.read")).toBe(false);
    expect(can(session, null, "projects.read")).toBe(false);
    expect(can(undefined, undefined, "projects.read")).toBe(false);
  });
});

describe("findOrgBySlug / activeOrg", () => {
  it("finds an org by slug", () => {
    expect(findOrgBySlug(session, "globex")?.id).toBe("org-b");
  });

  it("returns null for an unknown slug rather than throwing", () => {
    expect(findOrgBySlug(session, "nope")).toBeNull();
  });

  it("resolves the active org", () => {
    expect(activeOrg(session)?.slug).toBe("acme");
  });

  it("returns null when the active org id is not among the memberships", () => {
    expect(activeOrg({ ...session, activeOrgId: "org-gone" })).toBeNull();
  });
});
