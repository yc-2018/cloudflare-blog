export type Visibility = "public" | "private" | "password";
export type ImageHostProvider = "imgbb" | "pixhost";

export interface ImageUploadResponse {
  url: string;
  provider: ImageHostProvider;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  count?: number;
}

export interface ArticleSummary {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl: string;
  searchSnippet?: string;
  visibility: Visibility;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  tags: Tag[];
}

export interface Article extends ArticleSummary {
  content: string;
  accessPassword?: string;
}

export interface ArticleListResponse {
  articles: ArticleSummary[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface ArticleSearchResponse {
  articleResult: ArticleListResponse;
  allArticleTotal: number;
  untaggedArticleTotal: number;
  tags: Tag[];
}

export interface ArticleViewRecord {
  id: number;
  articleSlug: string;
  articleTitle: string;
  ipAddress: string;
  userAgent: string;
  deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  osName: string;
  browserName: string;
  viewedAt: string;
}

export interface StatisticsFilters {
  article: string;
  ip: string;
  device: string;
  from: string;
  to: string;
}

export interface ArticleViewStatisticsResponse {
  records: ArticleViewRecord[];
  articles: Array<{ slug: string; title: string }>;
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface ArticleInput {
  title: string;
  excerpt: string;
  coverImageUrl: string;
  content: string;
  visibility: Visibility;
  accessPassword: string;
  tags: string[];
}

export interface GuestbookMessage {
  id: number;
  articleId?: number | null;
  parentId: number | null;
  nickname: string;
  email?: string;
  content: string;
  replyToNickname?: string;
  status?: "pending" | "approved";
  invalid?: boolean;
  localPending?: boolean;
  createdAt: string;
  replies: GuestbookMessage[];
}

export interface GuestbookInput {
  nickname: string;
  email: string;
  content: string;
  parentId?: number | null;
  articleId?: number | null;
  articlePassword?: string;
  captchaToken?: string;
  captchaAnswer?: string;
}

export interface GuestbookCaptcha {
  question: string;
  token: string;
  expiresAt: number;
}

export interface ApiErrorPayload {
  error?: {
    code: string;
    message: string;
  };
}
