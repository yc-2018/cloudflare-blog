import type {
  ApiErrorPayload,
  Article,
  ArticleInput,
  ArticleListResponse,
  ArticleSearchResponse,
  ArticleViewStatisticsResponse,
  GuestbookCaptcha,
  GuestbookInput,
  GuestbookMessage,
  ImageHostProvider,
  ImageUploadResponse,
  StatisticsFilters,
  Tag
} from "./types";
import { buildStatisticsSearch } from "./statistics";

export class ApiRequestError extends Error {
  /** 创建一个 API 错误，其 code 让 UI 能够选择正确的恢复流程。 */
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init.headers
    },
    ...init
  });

  const data = (await response.json().catch(() => ({}))) as unknown;

  if (!response.ok) {
    const payload = typeof data === "object" && data !== null ? (data as ApiErrorPayload) : {};
    const message =
      typeof data === "object" && data !== null && payload.error?.message ? payload.error.message : "请求失败";
    throw new ApiRequestError(message, payload.error?.code ?? "UNKNOWN");
  }

  return data as T;
}

export async function getMe() {
  return requestJson<{ authenticated: boolean }>("/api/auth/me");
}

export async function login(username: string, password: string) {
  return requestJson<{ authenticated: boolean }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export async function logout() {
  return requestJson<{ authenticated: boolean }>("/api/auth/logout", {
    method: "POST"
  });
}

export async function listArticles(params: { page?: number; search?: string; tag?: string }) {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", String(params.page));
  if (params.search) searchParams.set("search", params.search);
  if (params.tag) searchParams.set("tag", params.tag);
  const query = searchParams.toString();
  return requestJson<ArticleListResponse>(`/api/articles${query ? `?${query}` : ""}`);
}

export async function searchArticles(params: { page?: number; search?: string; tag?: string }) {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", String(params.page));
  if (params.search) searchParams.set("search", params.search);
  if (params.tag) searchParams.set("tag", params.tag);
  const query = searchParams.toString();
  return requestJson<ArticleSearchResponse>(`/api/article-search${query ? `?${query}` : ""}`);
}

export async function listTags(params: { search?: string } = {}) {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set("search", params.search);
  const query = searchParams.toString();
  return requestJson<{ tags: Tag[] }>(`/api/tags${query ? `?${query}` : ""}`);
}

export async function getArticle(slug: string, password = "", includeDeleted = false) {
  const searchParams = new URLSearchParams();
  if (password) searchParams.set("password", password);
  if (includeDeleted) searchParams.set("deleted", "1");
  const query = searchParams.toString();
  return requestJson<{ article: Article }>(`/api/articles/${encodeURIComponent(slug)}${query ? `?${query}` : ""}`);
}

/** 获取一页仅管理员可见的文章浏览记录。 */
export async function listArticleViewStatistics(filters: StatisticsFilters, page = 1) {
  const query = buildStatisticsSearch(filters, page);
  return requestJson<ArticleViewStatisticsResponse>(`/api/statistics?${query}`);
}

export async function createArticle(input: ArticleInput) {
  return requestJson<{ article: Article }>("/api/articles", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateArticle(slug: string, input: ArticleInput) {
  return requestJson<{ article: Article }>(`/api/articles/${encodeURIComponent(slug)}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function deleteArticle(slug: string) {
  return requestJson<{ ok: boolean }>(`/api/articles/${encodeURIComponent(slug)}`, {
    method: "DELETE"
  });
}

/** 切换文章是否在公开文章列表中置顶。 */
export async function toggleArticlePinned(slug: string, pinned: boolean) {
  return requestJson<{ article: Article }>(`/api/articles/${encodeURIComponent(slug)}/pin`, {
    method: "POST",
    body: JSON.stringify({ pinned })
  });
}

export async function listDeletedArticles(params: { page?: number; search?: string } = {}) {
  const searchParams = new URLSearchParams({ deleted: "1" });
  if (params.page) searchParams.set("page", String(params.page));
  if (params.search) searchParams.set("search", params.search);
  return requestJson<ArticleListResponse>(`/api/articles?${searchParams}`);
}

export async function permanentlyDeleteArticle(slug: string) {
  return requestJson<{ ok: boolean }>(`/api/articles/${encodeURIComponent(slug)}?permanent=1`, {
    method: "DELETE"
  });
}

export async function restoreArticle(slug: string) {
  return requestJson<{ ok: boolean }>(`/api/articles/${encodeURIComponent(slug)}/restore`, {
    method: "POST"
  });
}

/** 通过已鉴权的 API 代理，将一张图片上传到指定的图床服务。 */
export async function uploadImageFile(file: File, provider: ImageHostProvider) {
  const formData = new FormData();
  formData.set("file", file, file.name);
  const response = await fetch(`/api/uploads?provider=${encodeURIComponent(provider)}`, {
    method: "POST",
    credentials: "include",
    body: formData
  });
  const data = (await response.json().catch(() => ({}))) as ImageUploadResponse & ApiErrorPayload;
  if (!response.ok) {
    throw new ApiRequestError(data.error?.message ?? "图片上传失败", data.error?.code ?? "UNKNOWN");
  }
  return data;
}

export async function listMessages(articleId?: number | null, password = "", localIds: number[] = []) {
  const params = new URLSearchParams();
  if (articleId) params.set("articleId", String(articleId));
  if (password) params.set("password", password);
  if (localIds.length) params.set("localIds", localIds.join(","));
  const query = params.toString();
  return requestJson<{ messages: GuestbookMessage[] }>(`/api/messages${query ? `?${query}` : ""}`);
}

export async function getMessageCaptcha() {
  return requestJson<{ captcha: GuestbookCaptcha }>("/api/messages/captcha");
}

export async function createMessage(input: GuestbookInput) {
  return requestJson<{ message: GuestbookMessage }>("/api/messages", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function approveMessage(id: number) {
  return requestJson<{ message: GuestbookMessage }>(`/api/messages/${id}/approve`, {
    method: "POST"
  });
}

export async function updateMessageStatus(id: number, status: "pending" | "approved", invalid = false) {
  return requestJson<{ message: GuestbookMessage }>(`/api/messages/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ status, invalid })
  });
}

export async function deleteMessage(id: number) {
  return requestJson<{ ok: boolean }>(`/api/messages/${id}`, {
    method: "DELETE"
  });
}
