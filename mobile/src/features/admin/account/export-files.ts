import { Alert } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { exportLabelFor, type ExportFile } from "./rules";

/**
 * The phone's version of the website's "save this file": write the prepared
 * export file (built server-side, never reshaped here) into the app's cache and
 * open the share sheet, so the owner can save it to Files / Drive, AirDrop it
 * or mail it. The cache folder is cleared before every export.
 */

const EXPORT_DIR = "store-export";

/** iOS type identifiers, so the sheet offers apps that open spreadsheets / JSON. */
const UTI_BY_MIME: Record<string, string> = {
  "text/csv": "public.comma-separated-values-text",
  "application/json": "public.json",
};

const safeName = (name: string): string => name.replace(/[^\w.-]+/g, "_").slice(0, 120) || "export.txt";
const baseMime = (mime: string): string => mime.split(";")[0].trim().toLowerCase();

function exportDir(): Directory {
  const dir = new Directory(Paths.cache, EXPORT_DIR);
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Write each file to the cache folder; returns their local URIs in order. */
export function writeExportFiles(files: readonly ExportFile[]): string[] {
  const dir = exportDir();
  return files.map((f) => {
    const out = new File(dir, safeName(f.filename));
    out.create({ overwrite: true });
    out.write(f.content);
    return out.uri;
  });
}

export class SharingUnavailableError extends Error {
  constructor() {
    super("Sharing isn't available on this device.");
  }
}

async function shareOne(uri: string, file: ExportFile): Promise<void> {
  const mime = baseMime(file.mime);
  await Sharing.shareAsync(uri, {
    mimeType: mime,
    UTI: UTI_BY_MIME[mime],
    dialogTitle: `Save ${exportLabelFor(file.filename)}`,
  });
}

/** Ask before opening the next sheet — "Next: Orders (2 of 5)". */
function askNext(file: ExportFile, index: number, total: number): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(`Next: ${exportLabelFor(file.filename)} (${index + 1} of ${total})`, file.filename, [
      { text: "Stop", style: "cancel", onPress: () => resolve(false) },
      { text: "Share", onPress: () => resolve(true) },
    ]),
  );
}

/**
 * Save one or more files via the share sheet, one after another. Returns how
 * many were handed to the sheet.
 */
export async function shareExportFiles(files: readonly ExportFile[]): Promise<number> {
  if (!(await Sharing.isAvailableAsync())) throw new SharingUnavailableError();
  const uris = writeExportFiles(files);
  let shared = 0;
  for (const [i, file] of files.entries()) {
    if (i > 0 && !(await askNext(file, i, files.length))) break;
    await shareOne(uris[i], file);
    shared += 1;
  }
  return shared;
}
