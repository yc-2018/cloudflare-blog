import { ApiRequestError, uploadImageFile } from "./api";
import type { ImageHostProvider, ImageUploadResponse } from "./types";

export const imageHostProviders: ImageHostProvider[] = ["imgbb", "pixhost"];
export const imageHostLabels: Record<ImageHostProvider, string> = {
  imgbb: "ImgBB",
  pixhost: "Pixhost"
};

const imageHostFailureStorageKey = "blog:imageHostFailures"; // 浏览器中存储各图床冷却时间戳的键。
const imageHostFailureCooldownMs = 30 * 60 * 1000; // 失败的图床经过多久后会再次尝试。
const webpMaxDimension = 2560; // 浏览器端缩放后输出的最大宽度或高度。
const webpQuality = 0.86; // 为保证截图与文章配图清晰而选定的 WebP 质量。
const coverMaxDimension = 1600; // 封面图显示在尺寸有限的卡片中，因此较小的上限已足够。
const coverWebpQuality = 0.8; // 封面质量以牺牲少量细节换取更小的上传体积。

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

const imagePathPattern = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i; // Markdown 预览与浏览器支持的图片扩展名。

/** 将单独成行的图片 URL 包裹为 Markdown 图片语法，同时不改动代码块和已有的 Markdown。 */
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

/** 检查 HTTP URL 的路径是否带有常见的图片扩展名。 */
function isImageUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && imagePathPattern.test(url.pathname);
  } catch {
    return false;
  }
}

/** 将粘贴的静态图片转换为有尺寸上限的 WebP，同时保留 GIF 动画。 */
export async function prepareImageForUpload(file: File, options: ImagePreparationOptions = {}): Promise<PreparedImage> {
  const maxDimension = options.maxDimension ?? webpMaxDimension; // 处理后图片的最大宽度或高度。
  const quality = options.quality ?? webpQuality; // 处理后图片的 WebP 编码质量。
  const shouldReencodeWebp = options.reencodeWebp ?? false; // 是否也重新压缩已有的 WebP。

  if (!file.type.startsWith("image/") || file.type === "image/gif" || (file.type === "image/webp" && !shouldReencodeWebp)) {
    return { file, convertedToWebp: false, optimized: false };
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height)); // 缩放比例，绝不会放大原图。
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

/** 按卡片尺寸上限处理封面图，并同样重新压缩已有的 WebP 文件。 */
export function prepareCoverImageForUpload(file: File) {
  return prepareImageForUpload(file, { maxDimension: coverMaxDimension, quality: coverWebpQuality, reencodeWebp: true });
}

/** 按优先级依次通过可用的图床上传，并在本地记录失败情况。 */
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

/** 返回图床的优先顺序，同时跳过仍处于失败冷却期的图床。 */
export function orderedImageHostProviders(failures: ImageHostFailures, now: number) {
  const healthy = imageHostProviders.filter((provider) => {
    const failedAt = Number(failures[provider] ?? 0); // 最近一次失败的时间戳，图床未失败过时为零。
    return failedAt === 0 || now - failedAt >= imageHostFailureCooldownMs;
  });
  return healthy.length > 0 ? healthy : [...imageHostProviders];
}

/** 构建可用于替换临时上传占位标记的 Markdown。 */
export function markdownImage(url: string, alt = "图片") {
  return `![${alt}](${url})`;
}

/** 从浏览器存储中读取并校验各图床的失败时间戳。 */
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

/** 记录失败图床的时间戳，且不暴露图片内容。 */
function recordImageHostFailure(storage: Storage | null, provider: ImageHostProvider, failedAt: number) {
  if (!storage) {
    return;
  }
  const failures = readImageHostFailures(storage);
  failures[provider] = failedAt;
  try {
    storage.setItem(imageHostFailureStorageKey, JSON.stringify(failures));
  } catch {
    // 浏览器存储不可用时，上传降级逻辑仍可正常工作。
  }
}

/** 在图床下一次上传成功后移除其冷却记录。 */
function clearImageHostFailure(storage: Storage | null, provider: ImageHostProvider) {
  if (!storage) {
    return;
  }
  const failures = readImageHostFailures(storage);
  delete failures[provider];
  try {
    storage.setItem(imageHostFailureStorageKey, JSON.stringify(failures));
  } catch {
    // 上传成功不应仅因存储不可用而失败。
  }
}

/** 在浏览器隐私设置允许访问时返回本地存储。 */
function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 将基于回调的 canvas 编码器封装为 promise。 */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}
