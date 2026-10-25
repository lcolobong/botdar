const REVOKE_AFTER_MS = 10_000;

/** Hands the viewer a file through a temporary object URL; the only way an extension page saves. */
export function downloadText(fileName: string, contents: string, mimeType: string): void {
  const url: string = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const anchor: HTMLAnchorElement = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // Revoked later, not synchronously: Firefox has not opened the blob yet when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
