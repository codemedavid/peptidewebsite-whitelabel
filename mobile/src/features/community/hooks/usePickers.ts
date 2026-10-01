import { Image } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import type { UploadResponse } from "@contract";
import { communityApi } from "@/api/endpoints";
import { IMAGE_MIME_TYPES, imageFileName, imageMimeFor, MAX_IMAGE_BYTES, type FileDraft, type ImageDraft } from "../lib/attachments";
import { DOCUMENT_MIME_TYPES, docMimeFor, MAX_FILE_BYTES } from "../lib/documents";

export type ImageSource = "camera" | "library" | "files";

/** A pick that didn't produce something sendable, for a reason worth telling the person. */
export class PickError extends Error {}

const QUALITY = 0.8;

/** Camera, photo library or Files → a photo ready to attach, or null if cancelled. */
export async function pickImage(source: ImageSource): Promise<ImageDraft | null> {
  if (source === "files") return pickImageFromFiles();
  const permission =
    source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new PickError(
      source === "camera" ? "Allow camera access in Settings to take a photo." : "Allow photo access in Settings to share from your library.",
    );
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: QUALITY, exif: false };
  const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  return toImageDraft(asset.uri, imageMimeFor(asset.mimeType, asset.fileName), asset.fileName, asset.fileSize, asset.width, asset.height);
}

async function pickImageFromFiles(): Promise<ImageDraft | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: IMAGE_MIME_TYPES, copyToCacheDirectory: true, multiple: false });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const size = await measure(asset.uri);
  return toImageDraft(asset.uri, imageMimeFor(asset.mimeType, asset.name), asset.name, asset.size, size?.width, size?.height);
}

function toImageDraft(
  uri: string,
  mimeType: string | null,
  fileName: string | null | undefined,
  bytes: number | null | undefined,
  width?: number,
  height?: number,
): ImageDraft {
  if (!mimeType) throw new PickError("That file isn't a photo we can send. Try a JPG, PNG, WEBP or GIF.");
  if (bytes && bytes > MAX_IMAGE_BYTES) throw new PickError("That photo is over 10 MB. Pick a smaller one.");
  return { type: "image", uri, mimeType, name: imageFileName(mimeType, fileName), width: width || null, height: height || null };
}

function measure(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), () => resolve(null));
  });
}

/** Files → a document ready to attach, or null if cancelled. */
export async function pickDocument(): Promise<FileDraft | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: DOCUMENT_MIME_TYPES, copyToCacheDirectory: true, multiple: false });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const mimeType = docMimeFor(asset.mimeType, asset.name);
  if (!mimeType) throw new PickError("That file type can't be sent. Try a PDF, Word, Excel, PowerPoint, CSV or text file.");
  if (asset.size && asset.size > MAX_FILE_BYTES) throw new PickError("That file is over 25 MB. Pick a smaller one.");
  return { type: "file", uri: asset.uri, name: asset.name || "Document", mimeType, size: asset.size ?? null };
}

/** Upload a picked photo or document to the store's media folder. */
export function uploadDraft(draft: ImageDraft | FileDraft, signal?: AbortSignal): Promise<UploadResponse> {
  return communityApi.upload({ uri: draft.uri, name: draft.name, type: draft.mimeType }, signal);
}
