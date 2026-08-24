/**
 * Hands the browser a file built from a value already in memory.
 *
 * Lifted out of the organization-export screen, which was the only place doing
 * this, so the audit CSV export does not invent a second way. Both endpoints
 * return their payload as an ordinary RPC result and the file is assembled
 * here — no `Content-Disposition`, no streaming.
 *
 * That is a real constraint rather than a preference: the whole payload arrives
 * in memory first, which is fine at the sizes these screens produce and would
 * not be for an unbounded export. A production version of either would stream.
 */
export function downloadText(contents: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked immediately: the click has already handed the blob to the browser's
  // download machinery, and holding the URL leaks the payload.
  URL.revokeObjectURL(url);
}
