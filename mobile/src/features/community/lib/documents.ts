// Documents in chat: which files may be sent and how they are labelled.

/** Server limit (docs/mobile-admin/COMMUNITY.md): documents max 25 MB. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** pdf / doc / xls / ppt / txt / csv, per the design doc. */
const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
};

const MIME_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_BY_MIME).map(([mime, ext]) => [ext, mime]),
);

/** Types the document picker should offer. */
export const DOCUMENT_MIME_TYPES = Object.keys(EXTENSION_BY_MIME);

function extensionOf(fileName: string | null | undefined): string | null {
  const parts = fileName?.split(".") ?? [];
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : null;
}

/** A supported document mime type, taken from the picker or guessed from the file name. */
export function docMimeFor(mimeType: string | null | undefined, fileName: string | null | undefined): string | null {
  const given = mimeType?.toLowerCase();
  if (given && EXTENSION_BY_MIME[given]) return given;
  const extension = extensionOf(fileName);
  return (extension && MIME_BY_EXTENSION[extension]) || null;
}

/** "PDF", "DOCX" … for the badge on a document. */
export function fileTypeLabel(mimeType: string | null | undefined, fileName: string | null | undefined): string {
  const extension = (mimeType && EXTENSION_BY_MIME[mimeType.toLowerCase()]) || extensionOf(fileName);
  return extension ? extension.toUpperCase() : "FILE";
}

const KB = 1024;
const MB = KB * 1024;

/** "512 B", "2 KB", "1.5 MB"; empty when unknown. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  return `${Math.round((bytes / MB) * 10) / 10} MB`;
}
