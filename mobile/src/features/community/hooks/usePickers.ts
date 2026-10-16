import { Image } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { UploadResponse } from "@contract";
import { uploadDirect } from "@/api/client";
import { communityApi } from "@/api/endpoints";
import {
  IMAGE_MIME_TYPES,
  imageFileName,
  imageMimeFor,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  videoFileName,
  videoMimeFor,
  type FileDraft,
  type ImageDraft,
  type VideoDraft,
} from "../lib/attachments";
import { DOCUMENT_MIME_TYPES, docMimeFor, MAX_FILE_BYTES } from "../lib/documents";
import { PHOTO_QUALITY, photoPlan } from "../lib/media";

export type ImageSource = "camera" | "library" | "files";

/** A pick that didn't produce something sendable, for a reason worth telling the person. */
export class PickError extends Error {}

// Chat photos are picked at full quality and compressed once, by lightenPhoto —
// compressing in the picker too would JPEG them twice. Store images skip
// lightenPhoto, so the picker compresses them as before.
const QUALITY = 1;
const STORE_IMAGE_QUALITY = 0.8;
const VIDEO_QUALITY = 0.8;

/** A photo as picked, with its size on disk (null when the picker didn't say). */
type Picked = { draft: ImageDraft; bytes: number | null };

/**
 * Camera, photo library or Files → a photo ready to attach, or null if cancelled.
 * Shrunk for chat unless `lighten: false` (store images — website banners,
 * certificates, QR codes — keep their full detail).
 */
export async function pickImage(source: ImageSource, opts: { lighten?: boolean } = {}): Promise<ImageDraft | null> {
  const lighten = opts.lighten !== false;
  const picked = await pickRawImage(source, lighten ? QUALITY : STORE_IMAGE_QUALITY);
  if (!picked) return null;
  return lighten ? lightenPhoto(picked) : withinLimit(picked);
}

async function pickRawImage(source: ImageSource, quality: number): Promise<Picked | null> {
  if (source === "files") return pickImageFromFiles();
  const permission =
    source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new PickError(
      source === "camera" ? "Allow camera access in Settings to take a photo." : "Allow photo access in Settings to share from your library.",
    );
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality, exif: false };
  const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  return toPicked(asset.uri, imageMimeFor(asset.mimeType, asset.fileName), asset.fileName, asset.fileSize, asset.width, asset.height);
}

/**
 * Several photos from the library at once, as many as the system allows
 * (saved replies). Photos too big to send are left out and counted.
 */
export async function pickImages(): Promise<{ drafts: ImageDraft[]; skipped: number }> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new PickError("Allow photo access in Settings to add photos from your library.");
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: QUALITY, exif: false, allowsMultipleSelection: true, selectionLimit: 0, orderedSelection: true });
  if (result.canceled) return { drafts: [], skipped: 0 };
  const drafts: ImageDraft[] = [];
  let skipped = 0;
  for (const asset of result.assets) {
    try {
      drafts.push(await lightenPhoto(toPicked(asset.uri, imageMimeFor(asset.mimeType, asset.fileName), asset.fileName, asset.fileSize, asset.width, asset.height)));
    } catch {
      skipped++;
    }
  }
  return { drafts, skipped };
}

async function pickImageFromFiles(): Promise<Picked | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: IMAGE_MIME_TYPES, copyToCacheDirectory: true, multiple: false });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const size = await measure(asset.uri);
  return toPicked(asset.uri, imageMimeFor(asset.mimeType, asset.name), asset.name, asset.size, size?.width, size?.height);
}

/**
 * Shrink a picked photo before it is sent: long edge 1600 px, JPEG (see
 * lib/media.ts). A phone photo drops from ~4 MB to a few hundred KB, which
 * also keeps it under the server's request size. GIFs and photos that are
 * already light go as picked; if re-encoding fails, the original is sent
 * (still held to the size limit).
 */
async function lightenPhoto(picked: Picked): Promise<ImageDraft> {
  const { draft, bytes } = picked;
  const plan = photoPlan({ mimeType: draft.mimeType, width: draft.width, height: draft.height, bytes });
  if (!plan) return withinLimit(picked);
  try {
    const context = ImageManipulator.manipulate(draft.uri);
    if (plan.resize) context.resize(plan.resize);
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY });
    const name = `${draft.name.replace(/\.[^.]*$/, "") || "photo"}.jpg`;
    return { ...draft, uri: saved.uri, mimeType: "image/jpeg", name, width: saved.width, height: saved.height };
  } catch {
    return withinLimit(picked);
  }
}

function withinLimit({ draft, bytes }: Picked): ImageDraft {
  if (bytes && bytes > MAX_IMAGE_BYTES) throw new PickError("That photo is over 10 MB. Pick a smaller one.");
  return draft;
}

function toPicked(
  uri: string,
  mimeType: string | null,
  fileName: string | null | undefined,
  bytes: number | null | undefined,
  width?: number,
  height?: number,
): Picked {
  if (!mimeType) throw new PickError("That file isn't a photo we can send. Try a JPG, PNG, WEBP or GIF.");
  return {
    draft: { type: "image", uri, mimeType, name: imageFileName(mimeType, fileName), width: width || null, height: height || null },
    bytes: bytes ?? null,
  };
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

/** Photo library → a video ready to upload (store team, welcome messages), or null if cancelled. */
export async function pickVideo(): Promise<VideoDraft | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new PickError("Allow photo access in Settings to share a video from your library.");
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], quality: VIDEO_QUALITY, allowsEditing: false });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  if (asset.fileSize && asset.fileSize > MAX_VIDEO_BYTES) throw new PickError("That video is over 50 MB. Trim it or pick a shorter one.");
  const mimeType = videoMimeFor(asset.mimeType, asset.fileName);
  return {
    type: "video",
    uri: asset.uri,
    mimeType,
    name: videoFileName(mimeType, asset.fileName),
    width: asset.width || null,
    height: asset.height || null,
    size: asset.fileSize ?? null,
  };
}

type ImageKitUploaded = { fileId: string };

/**
 * Upload a welcome video. Hosted stores get a signed ticket and the phone
 * sends the file straight to ImageKit, then the server checks and records it;
 * without a media host (demo/dev) it goes through the regular upload.
 */
export async function uploadVideo(draft: VideoDraft, signal?: AbortSignal): Promise<UploadResponse> {
  const file = { uri: draft.uri, name: draft.name, type: draft.mimeType };
  const ticket = await communityApi.videoTicket(draft.name);
  if (ticket.mode === "inline") return communityApi.upload(file, signal);
  const uploaded = await uploadDirect<ImageKitUploaded>(
    ticket.endpoint,
    {
      publicKey: ticket.publicKey,
      signature: ticket.signature,
      expire: String(ticket.expire),
      token: ticket.token,
      fileName: ticket.fileName,
      folder: ticket.folder,
      useUniqueFileName: "true",
      tags: "community",
    },
    file,
    signal,
  );
  return communityApi.confirmVideo({ fileId: uploaded.fileId, width: draft.width, height: draft.height });
}
