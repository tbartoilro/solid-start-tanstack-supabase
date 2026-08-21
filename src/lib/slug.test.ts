import { describe, expect, it } from "vitest";
import { isValidSlug, slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates words", () => {
    expect(slugify("Wonderland Ltd")).toBe("wonderland-ltd");
  });

  it("strips accents rather than dropping the letters", () => {
    expect(slugify("Ünïcorn Café")).toBe("unicorn-cafe");
  });

  it("collapses runs of punctuation into a single hyphen", () => {
    expect(slugify("Acme  ---  &&  Co.")).toBe("acme-co");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  --hello--  ")).toBe("hello");
  });

  it("does not leave a trailing hyphen after truncation", () => {
    // 48 chars would land mid-separator; the result must still be valid.
    const long = `${"a".repeat(47)} tail`;
    const result = slugify(long);
    expect(result).toHaveLength(47);
    expect(result.endsWith("-")).toBe(false);
    expect(isValidSlug(result)).toBe(true);
  });

  it("yields something the database constraint accepts", () => {
    for (const name of ["Wonderland Ltd", "Ünïcorn Café", "ACME & Co."]) {
      expect(isValidSlug(slugify(name))).toBe(true);
    }
  });

  it("returns a value the constraint rejects when there is nothing usable", () => {
    // Callers must handle this: "!!" has no slug, and "ab" is too short.
    expect(isValidSlug(slugify("!!"))).toBe(false);
    expect(isValidSlug(slugify("ab"))).toBe(false);
  });
});

describe("isValidSlug", () => {
  it("requires at least three characters", () => {
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("abc")).toBe(true);
  });

  it("rejects leading or trailing hyphens", () => {
    expect(isValidSlug("-abc")).toBe(false);
    expect(isValidSlug("abc-")).toBe(false);
    expect(isValidSlug("a-c")).toBe(true);
  });

  it("rejects uppercase and underscores", () => {
    expect(isValidSlug("Abc")).toBe(false);
    expect(isValidSlug("a_c")).toBe(false);
  });
});
