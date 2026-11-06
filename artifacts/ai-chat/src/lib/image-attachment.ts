export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export type PendingImage = {
  file: File;
  previewUrl: string;
  mimeType: SupportedImageType;
};

export function validateImageFile(file: File): string | null {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type as SupportedImageType)) {
    return "Choose a JPEG, PNG, or WebP image.";
  }
  if (file.size === 0) return "That image is empty.";
  if (file.size > MAX_IMAGE_BYTES) return "Images must be 3 MB or smaller.";
  return null;
}

/** Encode only for the transient request body; never add this value to conversation state. */
export async function imageFileToBase64(file: File): Promise<string> {
  const error = validateImageFile(file);
  if (error) throw new Error(error);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
