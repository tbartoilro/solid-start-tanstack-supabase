/**
 * CSV serialisation, for exporting a selection of rows.
 *
 * String in, string out. No `Response`, no `Content-Disposition`, no Blob —
 * deliberately, because the app already hands the browser a file by building a
 * Blob client-side from an RPC's return value, and matching that keeps the
 * download path in one shape. A pure function is also the only version that is
 * testable without a browser.
 */

export interface CsvColumn<TRow> {
  readonly header: string;
  readonly value: (row: TRow) => unknown;
}

/**
 * Renders one field per RFC 4180.
 *
 * Quoting is conditional rather than unconditional because unquoted output is
 * far easier to read when it is safe, and it usually is. A field needs quotes
 * if it contains the delimiter, a quote, or a newline; inside quotes, a quote
 * is doubled.
 *
 * The leading-character check is the non-obvious one. A value beginning `=`,
 * `+`, `-` or `@` is interpreted as a formula by Excel and Sheets, which turns
 * an exported audit log into an injection vector against whoever opens it. The
 * fix is to prefix a tab: spreadsheets then treat it as text, and it is
 * invisible in the cell.
 */
function field(value: unknown): string {
  if (value === null || value === undefined) return "";

  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `\t${raw}` : raw;

  return /[",\n\r\t]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * Rows to CSV, with a header line.
 *
 * CRLF line endings, as the RFC specifies — Excel on Windows is the main
 * consumer of a file like this, and it is the one that cares.
 */
export function toCsv<TRow>(rows: readonly TRow[], columns: readonly CsvColumn<TRow>[]): string {
  const lines = [columns.map((c) => field(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => field(c.value(row))).join(","));
  }
  return lines.join("\r\n");
}
