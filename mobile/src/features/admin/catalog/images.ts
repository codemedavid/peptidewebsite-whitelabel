import { ActionSheetIOS, Alert, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { UploadFile } from "@/api/client";
import { adminBridge } from "@/features/admin/bridge";

/**
 * Product photos: camera or library → uploadProductImageAction (the website's
 * own action, so the same 10 MB cap, ImageKit folder and media-library row).
 */

const MAX_BYTES = 10 * 1024 * 1024; // STOREFRONT_IMAGE_MAX_BYTES on the server
const QUALITY = 0.85;

export type PhotoSource = "camera" | "library";

/** A picked photo plus its original filename (bulk upload matches on it). */
export type PickedPhoto = UploadFile & { originalName: string };

/** A pick that can't be used, for a reason worth telling the seller. */
export class PhotoError extends Error {}

function toPhoto(asset: ImagePicker.ImagePickerAsset, i: number): PickedPhoto {
  if (asset.fileSize && asset.fileSize > MAX_BYTES) throw new PhotoError("Image too large (max 10 MB).");
  // The server only checks `image/*`; iOS hands back HEIC re-encoded as JPEG at quality < 1.
  const type = asset.mimeType?.startsWith("image/") ? asset.mimeType : "image/jpeg";
  const ext = type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const originalName = asset.fileName || `photo-${i + 1}.${ext}`;
  return { uri: asset.uri, type, name: originalName.includes(".") ? originalName : `${originalName}.${ext}`, originalName };
}

/** Open the camera or library. Null when cancelled. */
export async function pickPhotos(source: PhotoSource, multiple = false): Promise<PickedPhoto[] | null> {
  const permission =
    source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new PhotoError(source === "camera" ? "Allow camera access in Settings to take a photo." : "Allow photo access in Settings to choose a photo.");
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: QUALITY,
    exif: false,
    ...(multiple ? { allowsMultipleSelection: true, selectionLimit: 0 } : {}),
  };
  const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || result.assets.length === 0) return null;
  return result.assets.map(toPhoto);
}

/** Ask "camera or library?" the platform's way. Resolves null on cancel. */
export function askPhotoSource(title: string): Promise<PhotoSource | null> {
  return new Promise((resolve) => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { title, options: ["Take photo", "Choose from library", "Cancel"], cancelButtonIndex: 2 },
        (i) => resolve(i === 0 ? "camera" : i === 1 ? "library" : null),
      );
      return;
    }
    Alert.alert(title, undefined, [
      { text: "Take photo", onPress: () => resolve("camera") },
      { text: "Choose from library", onPress: () => resolve("library") },
      { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

type UploadResult = { url: string } | { error: string };

/** Upload one photo and return its hosted URL; the server's `{ error }` is thrown as-is. */
export async function uploadProductPhoto(photo: UploadFile, signal?: AbortSignal): Promise<string> {
  const res = await adminBridge.upload<UploadResult>("uploadProductImageAction", "file", photo, signal);
  if (res && "url" in res && res.url) return res.url;
  throw new Error((res && "error" in res && res.error) || "Upload failed — please try again.");
}
