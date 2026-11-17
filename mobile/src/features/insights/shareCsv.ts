import { Alert } from "react-native";
import { shareExportFiles, SharingUnavailableError } from "@/features/admin/account/export-files";

/**
 * Hand one CSV to the share sheet (save to Files / Drive, AirDrop, mail) — the
 * phone's "Download CSV", through the same export pipeline as Export my data.
 * A UTF-8 BOM keeps names with accents readable when Excel opens the file.
 */
export async function shareCsv(filename: string, csv: string): Promise<boolean> {
  try {
    const shared = await shareExportFiles([{ filename, mime: "text/csv", content: `﻿${csv}` }]);
    return shared > 0;
  } catch (e) {
    Alert.alert(
      "Couldn't export",
      e instanceof SharingUnavailableError ? e.message : e instanceof Error ? e.message : "Please try again.",
    );
    return false;
  }
}
