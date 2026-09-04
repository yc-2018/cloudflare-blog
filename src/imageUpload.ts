import { ApiRequestError, uploadImageFile } from "./api";
import type { ImageHostProvider, ImageUploadResponse } from "./types";

export const imageHostProviders: ImageHostProvider[] = ["imgbb", "pixhost"];
export const imageHostLabels: Record<ImageHostProvider, string> = {
  imgbb: "ImgBB",
  pixhost: "Pixhost"
};

const imageHostFailureStorageKey = "blog:imageHostFailures"; // Browser key for provider cooldown timestamps.
const imageHostFailureCooldownMs = 30 * 60 * 1000; // Time before a failed provider is tried again.
const webpMaxDimension = 2560; // Maximum output width or height after browser-side resizing.
const webpQuality = 0.86; // WebP quality chosen for readable screenshots and article photos.
const coverMaxDimension = 1600; // Cover images are displayed in a bounded card, so a smaller maximum is sufficient.
const coverWebpQuality = 0.8; // Cover quality trades a little detail for a smaller upload size.

export type ImageHostFailures = Partial<Record<ImageHostProvider, number>>;

export interface PreparedImage {
  file: File;
  convertedToWebp: boolean;
  optimized: boolean;
}

interface ImagePreparationOptions {
  maxDimension?: number;
  quality?: number;
  reencodeWebp?: boolean;
}

export interface ImageLinkConversion {
  content: string;
  convertedCount: number;
}

const imagePathPattern = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i; // Image extensions supported by Markdown previews and browsers.

/** Wraps standalone image URLs in Markdown image syntax while leaving code blocks and existing Markdown untouched. */
export function convertStandaloneImageLinks(content: string): ImageLinkConversion {
  let convertedCount = 0;
  let fenceMarker = "";
  const convertedContent = content
    .split(/(\r?\n)/)
    .map((part) => {
      if (/^\r?\n$/.test(part)) {
        return part;
      }

      const fenceMatch = part.match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        fenceMarker = fenceMarker === marker ? "" : fenceMarker || marker;
        return part;
      }
      if (fenceMarker || /^ {4}/.test(part)) {
        return part;
      }

      const urlLine = part.match(/^(\s*)(https?:\/\/\S+?)(\s*)$/i);
      if (!urlLine || !isImageUrl(urlLine[2])) {
        return part;
      }

      convertedCount += 1;
      return `${urlLine[1]}${markdownImage(urlLine[2], "")}${urlLine[3]}`;
    })
    .join("");

  return { content: convertedContent, convertedCount };
}

/** Checks an HTTP URL's path for a common image extension. */
function isImageUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && imagePathPattern.test(url.pathname);
  } catch {
    return false;
  }
}

/** Converts pasted static images to bounded WebP while preserving GIF animation. */
export async function prepareImageForUpload(file: File, options: ImagePreparationOptions = {}): Promise<PreparedImage> {
  const maxDimension = options.maxDimension ?? webpMaxDimension; // Maximum width or height for the prepared image.
  const quality = options.quality ?? webpQuality; // WebP encoder quality for the prepared image.
  const shouldReencodeWebp = options.reencodeWebp ?? false; // Whether an existing WebP should also be recompressed.

  if (!file.type.startsWith("image/") || file.type === "image/gif" || (file.type === "image/webp" && !shouldReencodeWebp)) {
    return { file, convertedToWebp: false, optimized: false };
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height)); // Resize ratio that never enlarges a source image.
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return { file, convertedToWebp: false, optimized: false };
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await canvasToBlob(canvas, "image/webp", quality);
    if (!blob) {
      return { file, convertedToWebp: false, optimized: false };
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "pasted-image";
    return {
      file: new File([blob], `${baseName}.webp`, { type: "image/webp" }),
      convertedToWebp: true,
      optimized: true
    };
  } catch {
    return { file, convertedToWebp: false, optimized: false };
  }
}

/** Prepares a cover image with a card-sized bound and recompresses existing WebP files too. */
export function prepareCoverImageForUpload(file: File) {
  return prepareImageForUpload(file, { maxDimension: coverMaxDimension, quality: coverWebpQuality, reencodeWebp: true });
}

/** Uploads through healthy providers in priority order and records failures locally. */
export async function uploadImageWithFallback(file: File): Promise<ImageUploadResponse> {
  const storage = browserStorage();
  const failures = readImageHostFailures(storage);
  const providers = orderedImageHostProviders(failures, Date.now());
  let lastError: unknown;

  for (const provider of providers) {
    try {
      const result = await uploadImageFile(file, provider);
      clearImageHostFailure(storage, provider);
      return result;
    } catch (error) {
      lastError = error;
      if (error instanceof ApiRequestError && ["BAD_REQUEST", "FORBIDDEN"].includes(error.code)) {
        throw error;
      }
      recordImageHostFailure(storage, provider, Date.now());
    }
  }

  throw lastError instanceof Error ? lastError : new Error("所有图床暂时都无法上传，请稍后再试");
}

/** Returns provider priority while skipping hosts still inside their failure cooldown. */
export function orderedImageHostProviders(failures: ImageHostFailures, now: number) {
  const healthy = imageHostProviders.filter((provider) => {
    const failedAt = Number(failures[provider] ?? 0); // Latest failure timestamp, or zero when the host has not failed.
    return failedAt === 0 || now - failedAt >= imageHostFailureCooldownMs;
  });
  return healthy.length > 0 ? healthy : [...imageHostProviders];
}

/** Builds Markdown that can replace a temporary upload marker. */
export function markdownImage(url: string, alt = "图片") {
  return `![${alt}](${url})`;
}

/** Reads and validates provider failure timestamps from browser storage. */
function readImageHostFailures(storage: Storage | null): ImageHostFailures {
  if (!storage) {
    return {};
  }

  try {
    const parsed = JSON.parse(storage.getItem(imageHostFailureStorageKey) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      imageHostProviders
        .filter((provider) => Number.isFinite(Number(parsed[provider])))
        .map((provider) => [provider, Number(parsed[provider])])
    ) as ImageHostFailures;
  } catch {
    return {};
  }
}

/** Stores a failed provider timestamp without exposing image contents. */
function recordImageHostFailure(storage: Storage | null, provider: ImageHostProvider, failedAt: number) {
  if (!storage) {
    return;
  }
  const failures = readImageHostFailures(storage);
  failures[provider] = failedAt;
  try {
    storage.setItem(imageHostFailureStorageKey, JSON.stringify(failures));
  } catch {
    // Upload fallback still works when browser storage is unavailable.
  }
}

/** Removes a provider cooldown after its next successful upload. */
function clearImageHostFailure(storage: Storage | null, provider: ImageHostProvider) {
  if (!storage) {
    return;
  }
  const failures = readImageHostFailures(storage);
  delete failures[provider];
  try {
    storage.setItem(imageHostFailureStorageKey, JSON.stringify(failures));
  } catch {
    // A successful upload should not fail only because storage is unavailable.
  }
}

/** Returns local storage when browser privacy settings allow access. */
function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Wraps the callback-based canvas encoder in a promise. */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}
