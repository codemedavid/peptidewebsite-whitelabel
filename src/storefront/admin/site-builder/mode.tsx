"use client";

// Where the Website Layout editor sends image uploads. The live store admin
// uploads to the tenant's ImageKit folder (the default); the dev-only sample
// page swaps in a browser-only reader so the editor works end to end there
// without a store-admin session or the database.

import { createContext, useContext, type ReactNode } from "react";
import { uploadStorefrontImageAction, type UploadImageResult } from "@/actions/media";

export type UploadImage = (file: File) => Promise<UploadImageResult>;

const serverUpload: UploadImage = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", "branding");
  return uploadStorefrontImageAction(fd);
};

const UploadContext = createContext<UploadImage>(serverUpload);

export function SiteBuilderUploadProvider({ upload, children }: { upload: UploadImage; children: ReactNode }) {
  return <UploadContext.Provider value={upload}>{children}</UploadContext.Provider>;
}

export function useUploadImage(): UploadImage {
  return useContext(UploadContext);
}
