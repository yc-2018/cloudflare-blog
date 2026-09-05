import {
  StatisticsFilterError,
  listArticleViewStatistics,
  parseStatisticsFilters,
  recordArticleView
} from "./articleStatistics";

interface Env {
  DB: D1Database;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  IMGBB_API_KEY?: string;
  SESSION_SECRET: string;
}

type Visibility = "public" | "private" | "password";
type ImageHostProvider = "imgbb" | "pixhost";
const untaggedArticleFilter = "__untagged__"; // 用于查询没有 article_tags 记录文章的保留标签值。

interface ArticleRow {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  cover_image_url: string;
  content_md: string;
  visibility: Visibility;
  access_password: string;
  view_count: number;
  created_at: string;
  updated_at: string;
  pinned_at?: string | null;
  deleted_at?: string | null;
}

interface TagRow {
  id: number;
  name: string;
  slug: string;
}

interface ArticleInput {
  title: string;
  excerpt?: string;
  coverImageUrl?: string;
  content: string;
  visibility: Visibility;
  accessPassword?: string;
  tags: string[];
}

interface SearchSnippetRow {
  title: string;
  excerpt: string;
  content_md: string;
}

interface MessageRow {
  id: number;
  article_id: number | null;
  parent_id: number | null;
  nickname: string;
  email: string;
  content: string;
  author_hash: string;
  reply_to_nickname: string;
  status: MessageStatus;
  invalid: number;
  created_at: string;
}

interface MessageInput {
  nickname: string;
  email: string;
  content: string;
  parentId: number | null;
  articleId: number | null;
  articlePassword: string;
  captchaToken: string;
  captchaAnswer: string;
}

interface CaptchaOperands {
  left: number;
  right: number;
}

type MessageStatus = "pending" | "approved";

interface AuthConfig {
  username: string;
  password: string;
  sessionSecret: string;
}

type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMIT"
  | "PASSWORD_REQUIRED"
  | "INVALID_PASSWORD"
  | "UPLOAD_FAILED"
  | "METHOD_NOT_ALLOWED"
  | "SERVER_ERROR";

const sessionCookieName = "blog_session";
const oneWeekSeconds = 60 * 60 * 24 * 7;
const articlePageSize = 10; // 每页列表返回的文章数量。
const guestMessageIntervalSeconds = 120; // 访客两条留言之间的最小间隔秒数。
const messageCaptchaTtlMs = 10 * 60 * 1000; // 验证码令牌过期前的有效时长。
const messageNicknameMaxLength = 10; // 展示昵称的最大长度。
const messageEmailMaxLength = 120; // 供管理员查看而存储的邮箱最大长度。
const messageContentMaxLength = 500; // 纯文本留言的最大长度。
const passwordAttemptLimit = 5; // 每个访客在时间窗口内允许的文章密码失败尝试次数。
const passwordAttemptWindowMs = 60 * 60 * 1000; // 失败尝试统计的时间窗口长度。
const passwordBanMs = 60 * 60 * 1000; // 失败尝试过多后的 IP 封禁时长。
const imageUploadMaxBytes = 10 * 1024 * 1024; // 上传代理接受的最大转换后图片体积。
const imageProviderTimeoutMs = 15 * 1000; // 等待第三方图床响应的最长时间。
const remoteImageUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"; // 抓取远程图片时使用的 UA，部分站点会拒绝无 UA 的请求。
const imageExtensions: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export const onRequest: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const segments = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodePathSegment);

    if (segments[0] === "auth") {
      return await handleAuth(context, segments.slice(1));
    }

    if (segments[0] === "articles") {
      return await handleArticles(context, segments.slice(1));
    }

    if (segments[0] === "statistics") {
      return await handleStatistics(context, segments.slice(1));
    }

    if (segments[0] === "uploads") {
      return await handleUploads(context, segments.slice(1));
    }

    if (segments[0] === "article-search" && context.request.method === "GET") {
      return await handleArticleSearch(context);
    }

    if (segments[0] === "messages") {
      return await handleMessages(context, segments.slice(1));
    }

    if (segments[0] === "tags") {
      return await handleTags(context, segments.slice(1));
    }

    return jsonError("NOT_FOUND", "接口不存在", 404);
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonError(error.code, error.message, error.status);
    }

    console.error(error);
    return jsonError("SERVER_ERROR", "服务器开小差了，请稍后再试", 500);
  }
};

/** 仅在通过管理员鉴权后，才提供持久化的文章浏览明细。 */
async function handleStatistics(context: EventContext<Env, string, unknown>, segments: string[]) {
  const { request, env } = context;
  await requireAuth(request, env);

  if (segments.length > 0 || request.method !== "GET") {
    return jsonError("METHOD_NOT_ALLOWED", "不支持的统计请求", 405);
  }

  try {
    const filters = parseStatisticsFilters(new URL(request.url));
    return json(await listArticleViewStatistics(env.DB, filters));
  } catch (error) {
    if (error instanceof StatisticsFilterError) {
      throw new ApiError("BAD_REQUEST", error.message, 400);
    }
    throw error;
  }
}

/** 处理供筛选器和编辑器建议使用的标签列表请求。 */
async function handleTags(context: EventContext<Env, string, unknown>, segments: string[]) {
  const { request, env } = context;

  if (segments.length === 0 && request.method === "GET") {
    const url = new URL(request.url);
    return json({
      tags: await listTags(env.DB, {
        authenticated: await isAuthenticated(request, env),
        search: url.searchParams.get("search") ?? ""
      })
    });
  }

  return jsonError("METHOD_NOT_ALLOWED", "不支持的标签请求", 405);
}

/** 将已鉴权的图片上传请求转发到第三方图床。 */
async function handleUploads(context: EventContext<Env, string, unknown>, segments: string[]) {
  const { request, env } = context;

  if (segments.length === 0 && request.method === "POST") {
    await requireAuth(request, env);
    const provider = requireImageHostProvider(request);

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ApiError("BAD_REQUEST", "请选择要上传的图片", 400);
    }

    const extension = imageExtensions[file.type];
    if (!extension) {
      throw new ApiError("BAD_REQUEST", "仅支持 JPEG、PNG、WebP 和 GIF 图片", 400);
    }

    if (file.size <= 0 || file.size > imageUploadMaxBytes) {
      throw new ApiError("BAD_REQUEST", "图片大小需要在 10 MB 以内", 400);
    }

    const url = await uploadImageToProvider(provider, file, extension, env);
    return json({ url, provider });
  }

  if (segments.length === 1 && segments[0] === "remote" && request.method === "POST") {
    await requireAuth(request, env);
    const provider = requireImageHostProvider(request);
    const sourceUrl = String((await readJson<{ url?: string }>(request)).url ?? "").trim(); // 待转存的原始图片地址。
    const file = await downloadRemoteImage(sourceUrl);

    const url = await uploadImageToProvider(provider, file, imageExtensions[file.type], env);
    return json({ url, provider });
  }

  return jsonError("METHOD_NOT_ALLOWED", "不支持的图片请求", 405);
}

/** 解析并校验上传请求中的图床参数。 */
function requireImageHostProvider(request: Request) {
  const provider = new URL(request.url).searchParams.get("provider") as ImageHostProvider | null;
  if (!provider || !["imgbb", "pixhost"].includes(provider)) {
    throw new ApiError("BAD_REQUEST", "不支持的图床", 400);
  }
  return provider;
}

/**
 * 抓取管理员粘贴过来的远程图片，并校验其类型与体积。
 * 浏览器受同源策略限制读不到跨站图片内容，因此这一步必须放在服务端。
 */
async function downloadRemoteImage(sourceUrl: string) {
  let source: URL;
  try {
    source = new URL(sourceUrl);
  } catch {
    throw new ApiError("BAD_REQUEST", "原始图片地址无法解析", 400);
  }
  if (!["http:", "https:"].includes(source.protocol)) {
    throw new ApiError("BAD_REQUEST", "只能转存 http 或 https 图片地址", 400);
  }

  const response = await fetchRemoteImage(source);

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(); // 远程图片的 MIME 类型。
  const extension = imageExtensions[contentType];
  if (!extension) {
    throw new ApiError("BAD_REQUEST", "原始地址不是受支持的图片格式", 400);
  }

  const blob = await response.blob();
  if (blob.size <= 0 || blob.size > imageUploadMaxBytes) {
    throw new ApiError("BAD_REQUEST", "图片大小需要在 10 MB 以内", 400);
  }
  return new File([blob], `image.${extension}`, { type: contentType });
}

/**
 * 依次尝试不同的 Referer 抓取远程图片，返回第一个成功的响应。
 * 各站点的防盗链策略正好相反：CSDN 的图片 CDN 会拒绝带图片自身域名的 Referer，
 * 而另一些站点又要求带上站内 Referer，因此先不带、失败再回退带上。
 */
async function fetchRemoteImage(source: URL) {
  const referers = ["", `${source.origin}/`]; // 按成功率排序的 Referer 候选，空字符串表示不发送该请求头。
  let lastStatus = 0; // 最后一次失败的 HTTP 状态码，便于区分防盗链与地址失效。

  for (const referer of referers) {
    const response = await fetchWithTimeout(source.toString(), {
      method: "GET",
      headers: referer
        ? { "User-Agent": remoteImageUserAgent, Referer: referer }
        : { "User-Agent": remoteImageUserAgent }
    });
    if (response.ok) {
      return response;
    }
    lastStatus = response.status;
  }

  throw new ApiError("UPLOAD_FAILED", `无法读取原始图片（HTTP ${lastStatus}），可能存在防盗链限制`, 502);
}

/** 将一张图片上传到所选的存储服务商。 */
async function uploadImageToProvider(
  provider: ImageHostProvider,
  file: File,
  extension: string,
  env: Env
) {
  if (provider === "imgbb") {
    const apiKey = String(env.IMGBB_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new ApiError("UPLOAD_FAILED", "ImgBB API Key 尚未配置", 502);
    }

    const formData = new FormData();
    formData.set("key", apiKey);
    formData.set("image", file, `image.${extension}`);
    const response = await fetchWithTimeout("https://api.imgbb.com/1/upload", { method: "POST", body: formData });
    const result = (await response.json().catch(() => ({}))) as { success?: boolean; data?: { url?: string } };
    const url = String(result.data?.url ?? "");
    if (!response.ok || !result.success || !/^https:\/\/i\.ibb\.co\/[A-Za-z0-9/_-]+\.[A-Za-z0-9]+$/.test(url)) {
      throw new ApiError("UPLOAD_FAILED", "ImgBB 上传失败，请检查 API Key", 502);
    }
    return url;
  }

  const formData = new FormData();
  formData.set("img", file, `image.${extension}`);
  formData.set("content_type", "0");
  formData.set("max_th_size", "500");
  const response = await fetchWithTimeout("https://api.pixhost.to/images", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: formData
  });
  const result = (await response.json().catch(() => ({}))) as { th_url?: string };
  if (!response.ok || !result.th_url) {
    throw new ApiError("UPLOAD_FAILED", "Pixhost 上传失败", 502);
  }
  return pixhostFullImageUrl(result.th_url);
}

/** 将 Pixhost 缩略图 URL 转换为其对应的完整分辨率图片 URL。 */
export function pixhostFullImageUrl(thumbnailUrl: string) {
  try {
    const url = new URL(thumbnailUrl);
    const hostMatch = url.hostname.match(/^t(\d+)\.pixhost\.to$/);
    if (!hostMatch || !url.pathname.startsWith("/thumbs/")) {
      throw new Error("Unexpected Pixhost URL");
    }
    url.protocol = "https:";
    url.hostname = `img${hostMatch[1]}.pixhost.to`;
    url.pathname = url.pathname.replace(/^\/thumbs\//, "/images/");
    return url.toString();
  } catch {
    throw new ApiError("UPLOAD_FAILED", "Pixhost 返回了无法识别的图片地址", 502);
  }
}

/** 为第三方图床请求设置有时限的超时。 */
async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), imageProviderTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new ApiError("UPLOAD_FAILED", "图床连接失败，请尝试其他图床", 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function handleAuth(context: EventContext<Env, string, unknown>, segments: string[]) {
  const { request, env } = context;
  const action = segments[0];

  if (action === "me" && request.method === "GET") {
    return json({ authenticated: await isAuthenticated(request, env) });
  }

  if (action === "login" && request.method === "POST") {
    const authConfig = getAuthConfig(env);
    if (!authConfig) {
      return jsonError("SERVER_ERROR", "管理员登录配置未完成，请检查 Cloudflare Pages 环境变量", 500);
    }

    const body = await readJson<{ username?: string; password?: string }>(request);
    const username = String(body.username ?? "");
    const password = String(body.password ?? "");

    if (!safeEqual(username, authConfig.username) || !safeEqual(password, authConfig.password)) {
      return jsonError("UNAUTHORIZED", "用户名或密码不正确", 401);
    }

    const cookie = await createSessionCookie(request, authConfig);
    return json(
      { authenticated: true },
      {
        headers: {
          "Set-Cookie": cookie
        }
      }
    );
  }

  if (action === "logout" && request.method === "POST") {
    return json(
      { authenticated: false },
      {
        headers: {
          "Set-Cookie": `${sessionCookieName}=; ${cookieAttributes(request)} Max-Age=0`
        }
      }
    );
  }

  return jsonError("METHOD_NOT_ALLOWED", "不支持的认证请求", 405);
}

async function handleArticles(context: EventContext<Env, string, unknown>, segments: string[]) {
  const { request, env } = context;
  const authenticated = await isAuthenticated(request, env);

  if (segments.length === 0 && request.method === "GET") {
    const url = new URL(request.url);
    const deleted = url.searchParams.get("deleted") === "1"; // 管理员是否正在查看文章回收站。
    if (deleted) {
      await requireAuth(request, env);
    }

    return json({
      ...(await listArticles(env.DB, {
        authenticated: deleted ? true : authenticated,
        search: url.searchParams.get("search") ?? "",
        tag: url.searchParams.get("tag") ?? "",
        page: parsePositiveInteger(url.searchParams.get("page"), 1),
        limit: articlePageSize,
        deleted
      }))
    });
  }

  if (segments.length === 0 && request.method === "POST") {
    await requireAuth(request, env);
    const input = validateArticleInput(await readJson<Partial<ArticleInput>>(request));
    const article = await createArticle(env.DB, input);
    return json({ article }, { status: 201 });
  }

  const slug = segments[0];
  if (!slug) {
    return jsonError("NOT_FOUND", "文章不存在", 404);
  }

  if (segments.length === 2 && segments[1] === "restore" && request.method === "POST") {
    await requireAuth(request, env);
    const result = await env.DB
      .prepare("UPDATE articles SET deleted_at = NULL, updated_at = datetime('now') WHERE slug = ? AND deleted_at IS NOT NULL")
      .bind(slug)
      .run();

    if (result.meta.changes === 0) {
      return jsonError("NOT_FOUND", "回收站里没有这篇文章", 404);
    }

    return json({ ok: true });
  }

  if (segments.length === 2 && segments[1] === "pin" && request.method === "POST") {
    await requireAuth(request, env);
    const body = await readJson<{ pinned?: boolean }>(request);
    if (typeof body.pinned !== "boolean") {
      return jsonError("BAD_REQUEST", "置顶状态不正确", 400);
    }
    const result = await env.DB
      .prepare("UPDATE articles SET pinned_at = ? WHERE slug = ? AND deleted_at IS NULL")
      .bind(body.pinned ? new Date().toISOString() : null, slug)
      .run();
    if (!result.meta.changes) {
      return jsonError("NOT_FOUND", "文章不存在", 404);
    }
    const article = await getArticleBySlug(env.DB, slug);
    if (!article) {
      return jsonError("NOT_FOUND", "文章不存在", 404);
    }
    return json({ article: await articleWithTags(env.DB, article, true, true) });
  }

  if (request.method === "GET") {
    const includeDeleted = new URL(request.url).searchParams.get("deleted") === "1"; // 管理员是否正在打开回收站中的文章。
    if (includeDeleted) {
      await requireAuth(request, env);
    }

    const article = await getArticleBySlug(env.DB, slug, includeDeleted);
    if (!article || (!authenticated && article.visibility === "private" && !article.access_password)) {
      return jsonError("NOT_FOUND", "文章不存在或需要登录后查看", 404);
    }

    if (!authenticated && article.access_password) {
      const suppliedPassword = new URL(request.url).searchParams.get("password") ?? "";
      await verifyArticlePassword(request, env.DB, env.SESSION_SECRET, article.access_password, suppliedPassword);
    }

    if (!authenticated) {
      try {
        if (await recordArticleView(env.DB, article.id, request, env.SESSION_SECRET)) {
          article.view_count = Number(article.view_count ?? 0) + 1;
        }
      } catch (error) {
        console.error("Failed to record article view", error);
      }
    }

    return json({ article: await articleWithTags(env.DB, article, true, authenticated) });
  }

  if (request.method === "PUT") {
    await requireAuth(request, env);
    const input = validateArticleInput(await readJson<Partial<ArticleInput>>(request));
    const updated = await updateArticle(env.DB, slug, input);

    if (!updated) {
      return jsonError("NOT_FOUND", "文章不存在", 404);
    }

    return json({ article: updated });
  }

  if (request.method === "DELETE") {
    await requireAuth(request, env);
    const permanent = new URL(request.url).searchParams.get("permanent") === "1"; // 是否物理删除该数据行。
    const result = permanent
      ? await permanentlyDeleteArticle(env.DB, slug)
      : await env.DB
          .prepare("UPDATE articles SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE slug = ? AND deleted_at IS NULL")
          .bind(slug)
          .run();

    if (result.meta.changes === 0) {
      return jsonError("NOT_FOUND", "文章不存在", 404);
    }

    return json({ ok: true });
  }

  return jsonError("METHOD_NOT_ALLOWED", "不支持的文章请求", 405);
}

async function handleArticleSearch(context: EventContext<Env, string, unknown>) {
  const { request, env } = context;
  const authenticated = await isAuthenticated(request, env);
  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? "";
  const tag = url.searchParams.get("tag") ?? "";
  const page = parsePositiveInteger(url.searchParams.get("page"), 1);
  const [articleResult, allArticleResult, untaggedArticleTotal, tags] = await Promise.all([
    listArticles(env.DB, {
      authenticated,
      search,
      tag,
      page,
      limit: articlePageSize
    }),
    listArticles(env.DB, {
      authenticated,
      search,
      tag: "",
      page: 1,
      limit: articlePageSize
    }),
    countUntaggedArticles(env.DB, { authenticated, search }),
    listTags(env.DB, {
      authenticated,
      search
    })
  ]);

  return json({
    articleResult,
    allArticleTotal: allArticleResult.total,
    untaggedArticleTotal,
    tags
  });
}

/** 处理留言板留言请求，并应用与鉴权状态相关的行为。 */
async function handleMessages(context: EventContext<Env, string, unknown>, segments: string[]) {
  const { request, env } = context;
  const authenticated = await isAuthenticated(request, env);

  if (segments[0] === "captcha" && request.method === "GET") {
    return json({ captcha: await createGuestbookCaptcha(env.SESSION_SECRET) });
  }

  if (segments.length === 0 && request.method === "GET") {
    const url = new URL(request.url);
    const articleId = parseOptionalPositiveInteger(url.searchParams.get("articleId"));
    const localIds = parseMessageIds(url.searchParams.get("localIds"));
    if (articleId !== null) {
      const article = await getArticleById(env.DB, articleId);
      if (!article) return jsonError("NOT_FOUND", "文章不存在", 404);
      await ensureArticleAccessible(request, env, article, url.searchParams.get("password") ?? "", authenticated);
    }
    return json({ messages: await listMessages(env.DB, authenticated, articleId, localIds) });
  }

  if (segments.length === 0 && request.method === "POST") {
    const input = validateMessageInput(await readJson<Partial<MessageInput>>(request), authenticated);
    if (!authenticated && !(await verifyGuestbookCaptcha(env.SESSION_SECRET, input.captchaToken, input.captchaAnswer))) {
      return jsonError("BAD_REQUEST", "验证码不正确或已过期", 400);
    }

    const article = input.articleId === null ? null : await getArticleById(env.DB, input.articleId);
    if (input.articleId !== null) {
      if (!article) return jsonError("NOT_FOUND", "文章不存在", 404);
      await ensureArticleAccessible(request, env, article, input.articlePassword, authenticated);
    }

    const replyTargetRow = input.parentId ? await getMessageById(env.DB, input.parentId) : null;
    if (replyTargetRow && replyTargetRow.article_id !== input.articleId) {
      return jsonError("BAD_REQUEST", "回复目标不属于当前留言区", 400);
    }
    const replyTarget = input.parentId ? normalizeReplyTarget(replyTargetRow) : null;
    const messageInput = replyTarget ? { ...input, parentId: replyTarget.parentId } : input;
    const replyToNickname = replyTarget?.replyToNickname ?? ""; // 平级的子回复之间显示的昵称。

    const authorHash = authenticated ? "admin" : await createGuestAuthorHash(request, env);
    if (!authenticated) {
      const waitSeconds = await remainingGuestWaitSeconds(env.DB, authorHash);
      if (waitSeconds > 0) {
        return jsonError("RATE_LIMIT", `发送太频繁了，请 ${waitSeconds} 秒后再试`, 429);
      }
    }

    const message = await createMessage(env.DB, messageInput, authorHash, replyToNickname);
    return json({ message: formatMessage(message, authenticated) }, { status: 201 });
  }

  if (segments.length === 2 && segments[1] === "approve" && request.method === "POST") {
    await requireAuth(request, env);
    const messageId = parsePositiveInteger(segments[0], 0);
    if (!messageId) {
      return jsonError("BAD_REQUEST", "留言 ID 不正确", 400);
    }

    const message = await approveMessage(env.DB, messageId);
    if (!message) {
      return jsonError("NOT_FOUND", "留言不存在", 404);
    }

    return json({ message: formatMessage(message, true) });
  }

  if (segments.length === 2 && segments[1] === "status" && request.method === "POST") {
    await requireAuth(request, env);
    const messageId = parsePositiveInteger(segments[0], 0);
    if (!messageId) return jsonError("BAD_REQUEST", "留言 ID 不正确", 400);
    const body = await readJson<{ status?: MessageStatus; invalid?: boolean }>(request);
    const status = body.status;
    if (status !== "pending" && status !== "approved") {
      return jsonError("BAD_REQUEST", "留言状态不正确", 400);
    }
    const message = await setMessageStatus(env.DB, messageId, status, Boolean(body.invalid));
    if (!message) return jsonError("NOT_FOUND", "留言不存在", 404);
    return json({ message: formatMessage(message, true) });
  }

  if (segments.length === 1 && request.method === "PUT") {
    await requireAuth(request, env);
    const messageId = parsePositiveInteger(segments[0], 0);
    if (!messageId) {
      return jsonError("BAD_REQUEST", "留言 ID 不正确", 400);
    }

    const content = String((await readJson<{ content?: string }>(request)).content ?? "").trim(); // 管理员改写后的留言正文。
    if (!content || content.length > messageContentMaxLength) {
      return jsonError("BAD_REQUEST", `留言内容需要在 1 到 ${messageContentMaxLength} 个字符之间`, 400);
    }

    const message = await setMessageContent(env.DB, messageId, content);
    if (!message) return jsonError("NOT_FOUND", "留言不存在", 404);
    return json({ message: formatMessage(message, true) });
  }

  if (segments.length === 1 && request.method === "DELETE") {
    await requireAuth(request, env);
    const messageId = parsePositiveInteger(segments[0], 0);
    if (!messageId) {
      return jsonError("BAD_REQUEST", "留言 ID 不正确", 400);
    }

    const result = await env.DB.prepare("DELETE FROM guestbook_messages WHERE id = ?").bind(messageId).run();
    if (result.meta.changes === 0) {
      return jsonError("NOT_FOUND", "留言不存在", 404);
    }

    return json({ ok: true });
  }

  return jsonError("METHOD_NOT_ALLOWED", "不支持的留言请求", 405);
}

/** 以两级树的形式返回留言板留言。 */
async function listMessages(db: D1Database, includeEmail: boolean, articleId: number | null = null, localIds: number[] = []) {
  const clauses = [includeEmail ? "1 = 1" : localIds.length ? `(status = 'approved' OR (status = 'pending' AND id IN (${localIds.map(() => "?").join(",")})))` : "status = 'approved'"];
  clauses.push(articleId === null ? "article_id IS NULL" : "article_id = ?");
  const bindings: number[] = articleId === null ? [] : [articleId];
  if (!includeEmail) bindings.unshift(...localIds);
  const result = await db
    .prepare(
      `
        SELECT id, article_id, parent_id, nickname, email, content, author_hash, reply_to_nickname, status, invalid, created_at
        FROM guestbook_messages
        WHERE ${clauses.join(" AND ")}
        ORDER BY datetime(created_at) ASC, id ASC
      `
    )
    .bind(...bindings)
    .all<MessageRow>();
  const roots = new Map<number, ReturnType<typeof formatMessage> & { replies: ReturnType<typeof formatMessage>[] }>();

  for (const row of result.results ?? []) {
    if (!row.parent_id) {
      roots.set(row.id, { ...formatMessage(row, includeEmail), replies: [] });
    }
  }

  for (const row of result.results ?? []) {
    if (row.parent_id) {
      roots.get(row.parent_id)?.replies.push(formatMessage(row, includeEmail));
    }
  }

  return Array.from(roots.values()).reverse();
}

/** 在校验和频率限制检查通过后，插入一条留言板留言。 */
async function createMessage(db: D1Database, input: MessageInput, authorHash: string, replyToNickname = "") {
  const status = authorHash === "admin" ? "approved" : "pending"; // 访客留言需经管理员审核后才能公开展示。
  const result = await db
    .prepare(
      `
        INSERT INTO guestbook_messages (article_id, parent_id, nickname, email, content, author_hash, reply_to_nickname, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id, article_id, parent_id, nickname, email, content, author_hash, reply_to_nickname, status, created_at
      `
    )
    .bind(input.articleId, input.parentId, input.nickname, input.email, input.content, authorHash, replyToNickname, status)
    .first<MessageRow>();

  if (!result) {
    throw new Error("Failed to create guestbook message");
  }

  return result;
}

/** 将一条待审核的留言板留言审核通过以公开展示。 */
async function approveMessage(db: D1Database, messageId: number) {
  return setMessageStatus(db, messageId, "approved", false);
}

/** 更新审核状态，同时返回完整的留言数据行。 */
async function setMessageStatus(db: D1Database, messageId: number, status: MessageStatus, invalid: boolean) {
  return db
    .prepare(
      `
        UPDATE guestbook_messages
        SET status = ?, invalid = ?
        WHERE id = ?
        RETURNING id, article_id, parent_id, nickname, email, content, author_hash, reply_to_nickname, status, created_at
      `
    )
    .bind(status, invalid ? 1 : 0, messageId)
    .first<MessageRow>();
}

/** 仅由管理员改写留言正文，同时返回完整的留言数据行。 */
async function setMessageContent(db: D1Database, messageId: number, content: string) {
  return db
    .prepare(
      `
        UPDATE guestbook_messages
        SET content = ?
        WHERE id = ?
        RETURNING id, article_id, parent_id, nickname, email, content, author_hash, reply_to_nickname, status, created_at
      `
    )
    .bind(content, messageId)
    .first<MessageRow>();
}

/** 解析本地保留的访客留言 ID，忽略格式错误的值。 */
function parseMessageIds(value: string | null) {
  return Array.from(new Set((value ?? "").split(",").map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))).slice(0, 50);
}

/** 查找作为直接回复目标的留言数据行。 */
async function getMessageById(db: D1Database, messageId: number) {
  return db
    .prepare("SELECT id, article_id, parent_id, nickname, email, content, author_hash, reply_to_nickname, status, invalid, created_at FROM guestbook_messages WHERE id = ?")
    .bind(messageId)
    .first<MessageRow>();
}

/** 将任意回复目标解析为根父级留言，以及可选的展示用目标昵称。 */
export function normalizeReplyTarget(target: Pick<MessageRow, "id" | "parent_id" | "nickname"> | null) {
  if (!target) {
    throw new ApiError("NOT_FOUND", "回复的留言不存在", 404);
  }

  if (target.parent_id) {
    return {
      parentId: target.parent_id,
      replyToNickname: target.nickname
    };
  }

  return {
    parentId: target.id,
    replyToNickname: ""
  };
}

/** 将数据库行转换为公开的留言板响应结构。 */
function formatMessage(row: MessageRow, includeEmail: boolean) {
  return {
    id: row.id,
    articleId: row.article_id,
    parentId: row.parent_id,
    nickname: row.nickname,
    email: includeEmail ? row.email : undefined,
    content: row.content,
    replyToNickname: row.reply_to_nickname || undefined,
    status: row.status,
    invalid: Boolean(row.invalid),
    createdAt: row.created_at,
    replies: []
  };
}

async function listArticles(
  db: D1Database,
  options: { authenticated: boolean; search: string; tag: string; page: number; limit: number; deleted?: boolean }
) {
  const clauses: string[] = [];
  const bindings: Array<string | number> = [];
  let joinTag = "";

  clauses.push(options.deleted ? "a.deleted_at IS NOT NULL" : "a.deleted_at IS NULL");

  if (!options.authenticated) {
    clauses.push("a.visibility = 'public'");
  }

  const search = options.search.trim();
  if (search) {
    const like = `%${search}%`;
    clauses.push("(a.title LIKE ? OR a.excerpt LIKE ? OR a.content_md LIKE ?)");
    bindings.push(like, like, like);
  }

  const tag = options.tag.trim();
  if (tag === untaggedArticleFilter) {
    clauses.push(
      `NOT EXISTS (
        SELECT 1
        FROM article_tags at_filter
        WHERE at_filter.article_id = a.id
      )`
    );
  } else if (tag) {
    joinTag = "JOIN article_tags at_filter ON at_filter.article_id = a.id JOIN tags t_filter ON t_filter.id = at_filter.tag_id";
    clauses.push("t_filter.slug = ?");
    bindings.push(tag);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const countQuery = `
    SELECT COUNT(DISTINCT a.id) AS total
    FROM articles a
    ${joinTag}
    ${where}
  `;
  const query = `
    SELECT a.id, a.slug, a.title, a.excerpt, a.cover_image_url, a.content_md, a.visibility, a.access_password, a.view_count, a.created_at, a.updated_at, a.pinned_at, a.deleted_at
    FROM articles a
    ${joinTag}
    ${where}
    GROUP BY a.id
    ORDER BY CASE WHEN a.pinned_at IS NULL THEN 1 ELSE 0 END, datetime(a.pinned_at) DESC, datetime(a.updated_at) DESC
    LIMIT ? OFFSET ?
  `;

  const offset = (options.page - 1) * options.limit; // 请求页之前需要跳过的行数。
  const countResult = await db.prepare(countQuery).bind(...bindings).first<{ total: number }>();
  const total = Number(countResult?.total ?? 0); // 分页前匹配的文章总数。
  const result = await db.prepare(query).bind(...bindings, options.limit, offset).all<ArticleRow>();
  const articles = await Promise.all(
    (result.results ?? []).map(async (row) => {
      const { content, ...article } = await articleWithTags(db, row, false);
      const searchSnippet = buildSearchSnippet(row, search); // 搜索时展示的正文命中片段。
      return searchSnippet ? { ...article, searchSnippet } : article;
    })
  );
  return {
    articles,
    page: options.page,
    limit: options.limit,
    total,
    hasMore: offset + articles.length < total
  };
}

/** 构建用于统计无标签文章的可见性与搜索条件子句。 */
export function buildUntaggedArticleFilter(authenticated: boolean, search: string) {
  const clauses = [
    "a.deleted_at IS NULL",
    `NOT EXISTS (
      SELECT 1
      FROM article_tags at_untagged
      WHERE at_untagged.article_id = a.id
    )`
  ];
  const bindings: string[] = [];

  if (!authenticated) {
    clauses.unshift("a.visibility = 'public'");
  }

  const normalizedSearch = search.trim();
  if (normalizedSearch) {
    const like = `%${normalizedSearch}%`;
    clauses.push("(a.title LIKE ? OR a.excerpt LIKE ? OR a.content_md LIKE ?)");
    bindings.push(like, like, like);
  }

  return { where: `WHERE ${clauses.join(" AND ")}`, bindings };
}

/** 统计当前鉴权与搜索范围内可用的无标签文章数量。 */
async function countUntaggedArticles(db: D1Database, options: { authenticated: boolean; search: string }) {
  const filter = buildUntaggedArticleFilter(options.authenticated, options.search);
  const result = await db
    .prepare(`SELECT COUNT(*) AS total FROM articles a ${filter.where}`)
    .bind(...filter.bindings)
    .first<{ total: number }>();
  return Number(result?.total ?? 0);
}

async function listTags(db: D1Database, options: { authenticated: boolean; search: string }) {
  const filters: string[] = ["a.deleted_at IS NULL"];
  const bindings: string[] = [];

  if (!options.authenticated) {
    filters.push("a.visibility = 'public'");
  }

  const search = options.search.trim();
  if (search) {
    const like = `%${search}%`;
    filters.push("(a.title LIKE ? OR a.excerpt LIKE ? OR a.content_md LIKE ?)");
    bindings.push(like, like, like);
  }

  const filteredArticleIds = filters.length
    ? `
      SELECT a.id
      FROM articles a
      WHERE ${filters.join(" AND ")}
    `
    : `
      SELECT a.id
      FROM articles a
    `;

  const result = await db
    .prepare(
      `
        SELECT t.id, t.name, t.slug, COUNT(filtered.id) AS count
        FROM tags t
        LEFT JOIN article_tags at ON at.tag_id = t.id
        LEFT JOIN (${filteredArticleIds}) filtered ON filtered.id = at.article_id
        GROUP BY t.id
        HAVING COUNT(filtered.id) > 0 OR ? = 1
        ORDER BY lower(t.name)
      `
    )
    .bind(...bindings, options.authenticated && !search ? 1 : 0)
    .all<TagRow & { count: number }>();

  return result.results ?? [];
}

async function createArticle(db: D1Database, input: ArticleInput) {
  const slug = await uniqueSlug(db, timestampSlug());
  const result = await db
    .prepare(
      `
        INSERT INTO articles (slug, title, excerpt, cover_image_url, content_md, visibility, access_password)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING id, slug, title, excerpt, cover_image_url, content_md, visibility, access_password, view_count, created_at, updated_at, pinned_at
      `
    )
    .bind(slug, input.title, input.excerpt ?? "", input.coverImageUrl ?? "", input.content, storedVisibility(input.visibility), input.accessPassword ?? "")
    .first<ArticleRow>();

  if (!result) {
    throw new Error("Failed to create article");
  }

  await replaceArticleTags(db, result.id, input.tags);
  await cleanupOrphanedTags(db);
  return articleWithTags(db, result, true, true);
}

async function updateArticle(db: D1Database, slug: string, input: ArticleInput) {
  const existing = await getArticleBySlug(db, slug);
  if (!existing) {
    return null;
  }

  const result = await db
    .prepare(
      `
        UPDATE articles
        SET title = ?, excerpt = ?, cover_image_url = ?, content_md = ?, visibility = ?, access_password = ?, updated_at = datetime('now')
        WHERE slug = ?
        RETURNING id, slug, title, excerpt, cover_image_url, content_md, visibility, access_password, view_count, created_at, updated_at, pinned_at
      `
    )
    .bind(input.title, input.excerpt ?? "", input.coverImageUrl ?? "", input.content, storedVisibility(input.visibility), input.accessPassword ?? "", slug)
    .first<ArticleRow>();

  if (!result) {
    return null;
  }

  await replaceArticleTags(db, result.id, input.tags);
  await cleanupOrphanedTags(db);
  return articleWithTags(db, result, true, true);
}

async function replaceArticleTags(db: D1Database, articleId: number, tagNames: string[]) {
  const tags = normalizedTags(tagNames);
  await db.prepare("DELETE FROM article_tags WHERE article_id = ?").bind(articleId).run();

  for (const name of tags) {
    const slug = slugify(name);
    const tag =
      (await db.prepare("SELECT id, name, slug FROM tags WHERE slug = ?").bind(slug).first<TagRow>()) ??
      (await db.prepare("INSERT INTO tags (name, slug) VALUES (?, ?) RETURNING id, name, slug").bind(name, slug).first<TagRow>());

    if (!tag) {
      throw new Error("Failed to upsert tag");
    }

    await db.prepare("INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)").bind(articleId, tag.id).run();
  }
}

/** 在标签与最后一篇文章的关联消失后，删除该标签记录。 */
async function cleanupOrphanedTags(db: D1Database) {
  await db
    .prepare(
      `
        DELETE FROM tags
        WHERE NOT EXISTS (
          SELECT 1
          FROM article_tags at
          WHERE at.tag_id = tags.id
        )
      `
    )
    .run();
}

/** 永久删除一篇已经在回收站中的文章。 */
async function permanentlyDeleteArticle(db: D1Database, slug: string) {
  await db
    .prepare("DELETE FROM article_tags WHERE article_id = (SELECT id FROM articles WHERE slug = ? AND deleted_at IS NOT NULL)")
    .bind(slug)
    .run();
  return db.prepare("DELETE FROM articles WHERE slug = ? AND deleted_at IS NOT NULL").bind(slug).run();
}

/** 先加载文章标签，再交由纯函数式的公开响应格式化器处理。 */
async function articleWithTags(db: D1Database, row: ArticleRow, includeContent = true, includePassword = false) {
  const tags = await getArticleTags(db, row.id);
  return formatArticleResponse(row, tags, includeContent, includePassword);
}

/** 格式化文章数据行，且不包含任何私密的访客统计字段。 */
export function formatArticleResponse(
  row: ArticleRow,
  tags: TagRow[],
  includeContent = true,
  includePassword = false
) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    coverImageUrl: row.cover_image_url ?? "",
    content: includeContent ? row.content_md : undefined,
    visibility: row.access_password ? "password" : row.visibility,
    ...(includePassword && row.access_password ? { accessPassword: row.access_password } : {}),
    viewCount: Number(row.view_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinnedAt: row.pinned_at ?? null,
    deletedAt: row.deleted_at ?? null,
    tags
  };
}

async function getArticleBySlug(db: D1Database, slug: string, includeDeleted = false) {
  return db
    .prepare(
      `
        SELECT id, slug, title, excerpt, cover_image_url, content_md, visibility, access_password, view_count, created_at, updated_at, pinned_at, deleted_at
        FROM articles
        WHERE slug = ?
        ${includeDeleted ? "" : "AND deleted_at IS NULL"}
      `
    )
    .bind(slug)
    .first<ArticleRow>();
}

async function getArticleTags(db: D1Database, articleId: number) {
  const result = await db
    .prepare(
      `
        SELECT t.id, t.name, t.slug
        FROM tags t
        JOIN article_tags at ON at.tag_id = t.id
        WHERE at.article_id = ?
        ORDER BY lower(t.name)
      `
    )
    .bind(articleId)
    .all<TagRow>();

  return result.results ?? [];
}

async function uniqueSlug(db: D1Database, baseSlug: string) {
  const base = baseSlug || "article";
  let candidate = base;
  let index = 2;

  while (await getArticleBySlug(db, candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }

  return candidate;
}

/** 为新发布的文章创建基于时间戳的 slug。 */
export function timestampSlug(date = new Date()) {
  return String(date.getTime());
}

/** 当搜索命中内容未显示在列表卡片上时，构建一段简短的正文片段。 */
export function buildSearchSnippet(row: SearchSnippetRow, search: string) {
  const query = search.trim(); // 访客输入的原始搜索词。
  if (!query || containsIgnoreCase(row.title, query) || containsIgnoreCase(row.excerpt, query)) {
    return "";
  }

  const bodyText = markdownToPlainText(row.content_md); // 转换为可读预览文本的 Markdown 正文。
  if (!containsIgnoreCase(bodyText, query)) {
    return "";
  }

  return snippetAroundMatch(bodyText, query);
}

/** 移除常见的 Markdown 语法，同时保留用户期望能搜索到的文字。 */
function markdownToPlainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, "").replace(/```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 以忽略大小写的方式检查文本，用于搜索和高亮判断。 */
function containsIgnoreCase(value: string, query: string) {
  return value.toLowerCase().includes(query.toLowerCase());
}

/** 围绕首个匹配的搜索词截取文本。 */
function snippetAroundMatch(text: string, query: string) {
  const lowerText = text.toLowerCase(); // 转小写的正文，用于稳定匹配。
  const lowerQuery = query.toLowerCase(); // 转小写的搜索词，用于稳定匹配。
  const matchIndex = lowerText.indexOf(lowerQuery);
  const contextBefore = 36; // 匹配词之前保留的字符数。
  const contextAfter = 72; // 匹配词之后保留的字符数。
  const start = Math.max(0, matchIndex - contextBefore);
  const end = Math.min(text.length, matchIndex + query.length + contextAfter);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  return `${prefix}${text.slice(start, end)}${suffix}`;
}

export function validateArticleInput(raw: Partial<ArticleInput>): ArticleInput {
  const title = String(raw.title ?? "").trim();
  const content = String(raw.content ?? "").trim();
  const excerpt = String(raw.excerpt ?? "").trim();
  const coverImageUrl = String(raw.coverImageUrl ?? "").trim();
  const visibility: Visibility = raw.visibility === "private" || raw.visibility === "password" ? raw.visibility : "public";
  const accessPassword = String(raw.accessPassword ?? "").trim();
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : [];

  if (title.length < 1 || title.length > 120) {
    throw new ApiError("BAD_REQUEST", "标题长度需要在 1 到 120 个字符之间", 400);
  }

  if (content.length < 1) {
    throw new ApiError("BAD_REQUEST", "文章内容不能为空", 400);
  }

  if (excerpt.length > 240) {
    throw new ApiError("BAD_REQUEST", "摘要不能超过 240 个字符", 400);
  }

  if (coverImageUrl.length > 2048) {
    throw new ApiError("BAD_REQUEST", "图片 URL 不能超过 2048 个字符", 400);
  }

  if (visibility === "password" && !/^[A-Za-z0-9]{4}$/.test(accessPassword)) {
    throw new ApiError("BAD_REQUEST", "密码可见文章需要 4 位字母或数字密码", 400);
  }

  return {
    title,
    content,
    excerpt,
    coverImageUrl,
    visibility,
    accessPassword: visibility === "password" ? accessPassword : "",
    tags: normalizedTags(tags)
  };
}

async function getArticleById(db: D1Database, articleId: number) {
  return db
    .prepare(
      `
        SELECT id, slug, title, excerpt, cover_image_url, content_md, visibility, access_password, view_count, created_at, updated_at, pinned_at
        FROM articles
        WHERE id = ?
      `
    )
    .bind(articleId)
    .first<ArticleRow>();
}

async function ensureArticleAccessible(
  request: Request,
  env: Env,
  article: ArticleRow,
  suppliedPassword: string,
  authenticated: boolean
) {
  if (authenticated) return;
  if (article.visibility === "private" && !article.access_password) {
    throw new ApiError("NOT_FOUND", "文章不存在或需要登录后查看", 404);
  }
  if (article.access_password) {
    await verifyArticlePassword(request, env.DB, env.SESSION_SECRET, article.access_password, suppliedPassword);
  }
}

/** 将仅存在于 UI 的密码可见性映射为数据库中已有的 private 状态。 */
function storedVisibility(visibility: Visibility): "public" | "private" {
  return visibility === "public" ? "public" : "private";
}

/** 校验文章密码，并为访客 IP 记录失败尝试次数。 */
async function verifyArticlePassword(
  request: Request,
  db: D1Database,
  sessionSecret: string,
  expectedPassword: string,
  suppliedPassword: string
) {
  if (!suppliedPassword) {
    throw new ApiError("PASSWORD_REQUIRED", "请输入文章访问密码", 401);
  }

  const visitorHash = await articlePasswordVisitorHash(request, sessionSecret);
  const now = Date.now();
  const attempt = await db
    .prepare("SELECT failed_count, window_started_at, blocked_until FROM article_password_attempts WHERE visitor_hash = ?")
    .bind(visitorHash)
    .first<{ failed_count: number; window_started_at: number; blocked_until: number }>();

  if (attempt?.blocked_until && attempt.blocked_until > now) {
    const retryAfter = Math.ceil((attempt.blocked_until - now) / 1000);
    throw new ApiError("RATE_LIMIT", `尝试次数过多，请 ${Math.ceil(retryAfter / 60)} 分钟后再试`, 429);
  }

  if (safeEqual(suppliedPassword, expectedPassword)) {
    await db.prepare("DELETE FROM article_password_attempts WHERE visitor_hash = ?").bind(visitorHash).run();
    return;
  }

  const inWindow = Boolean(attempt && now - attempt.window_started_at < passwordAttemptWindowMs);
  const failedCount = (inWindow ? attempt?.failed_count ?? 0 : 0) + 1;
  const windowStartedAt = inWindow ? attempt?.window_started_at ?? now : now;
  const blockedUntil = failedCount >= passwordAttemptLimit ? now + passwordBanMs : 0;
  await db
    .prepare(
      `
        INSERT INTO article_password_attempts (visitor_hash, failed_count, window_started_at, blocked_until, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(visitor_hash) DO UPDATE SET
          failed_count = excluded.failed_count,
          window_started_at = excluded.window_started_at,
          blocked_until = excluded.blocked_until,
          updated_at = datetime('now')
      `
    )
    .bind(visitorHash, failedCount, windowStartedAt, blockedUntil)
    .run();

  if (blockedUntil) {
    throw new ApiError("RATE_LIMIT", "密码错误次数过多，当前 IP 已封禁 1 小时", 429);
  }

  throw new ApiError("INVALID_PASSWORD", `密码错误，还可尝试 ${passwordAttemptLimit - failedCount} 次`, 403);
}

/** 对来访 IP 做哈希处理，使密码封禁表不存储原始地址。 */
async function articlePasswordVisitorHash(request: Request, sessionSecret: string) {
  const ip = request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
  return sign(`article-password:${ip}`, sessionSecret);
}

/** 校验并归一化访客与管理员提交的留言表单输入。 */
export function validateMessageInput(raw: Partial<MessageInput>, authenticated: boolean): MessageInput {
  const nickname = String(raw.nickname ?? "").trim();
  const email = authenticated ? String(raw.email ?? "").trim() : String(raw.email ?? "").trim();
  const content = String(raw.content ?? "").trim();
  const parentId = raw.parentId ? Number(raw.parentId) : null;
  const articleId = raw.articleId ? Number(raw.articleId) : null;
  const articlePassword = String(raw.articlePassword ?? "");
  const captchaToken = String(raw.captchaToken ?? "");
  const captchaAnswer = String(raw.captchaAnswer ?? "").trim();

  if (!nickname || nickname.length > messageNicknameMaxLength) {
    throw new ApiError("BAD_REQUEST", `昵称需要在 1 到 ${messageNicknameMaxLength} 个字符之间`, 400);
  }

  if (!authenticated && !email) {
    throw new ApiError("BAD_REQUEST", "邮箱不能为空", 400);
  }

  if (email.length > messageEmailMaxLength || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new ApiError("BAD_REQUEST", "邮箱格式不正确", 400);
  }

  if (!content || content.length > messageContentMaxLength) {
    throw new ApiError("BAD_REQUEST", `留言内容需要在 1 到 ${messageContentMaxLength} 个字符之间`, 400);
  }

  if (parentId !== null && (!Number.isInteger(parentId) || parentId <= 0)) {
    throw new ApiError("BAD_REQUEST", "回复目标不正确", 400);
  }

  if (articleId !== null && (!Number.isInteger(articleId) || articleId <= 0)) {
    throw new ApiError("BAD_REQUEST", "文章 ID 不正确", 400);
  }

  if (!authenticated && (!captchaToken || !captchaAnswer)) {
    throw new ApiError("BAD_REQUEST", "验证码不能为空", 400);
  }

  return {
    nickname,
    email,
    content,
    parentId,
    articleId,
    articlePassword,
    captchaToken,
    captchaAnswer
  };
}

/** 为留言板访客创建带签名的算术验证码挑战。 */
async function createGuestbookCaptcha(secret: string) {
  const operands = createCaptchaOperands();
  const answer = operands.left + operands.right; // 验证码的正确答案。
  const expiresAt = Date.now() + messageCaptchaTtlMs; // 验证码过期的绝对时间戳。
  const payload = encodePayload({ answer, expiresAt });
  const signature = await sign(payload, secret);
  return {
    question: `${operands.left} + ${operands.right} = ?`,
    token: `${payload}.${signature}`,
    expiresAt
  };
}

/** 生成有范围的验证码数字，保证在移动端也易于计算。 */
export function createCaptchaOperands(): CaptchaOperands {
  const left = Math.floor(Math.random() * 8) + 2; // 左操作数，取值 2 到 9。
  const right = Math.floor(Math.random() * 8) + 2; // 右操作数，取值 2 到 9。
  return { left, right };
}

/** 校验带签名的算术验证码令牌和提交的答案。 */
export async function verifyGuestbookCaptcha(secret: string, token: string, answer: string, now = Date.now()) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return false;
  }

  const expected = await sign(payload, secret);
  if (!safeEqual(signature, expected)) {
    return false;
  }

  const captcha = decodeCaptchaPayload(payload);
  return Boolean(captcha && captcha.expiresAt >= now && safeEqual(String(captcha.answer), answer.trim()));
}

/** 解码验证码载荷，且不信任格式错误的访客输入。 */
function decodeCaptchaPayload(payload: string): { answer: number; expiresAt: number } | null {
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const data = JSON.parse(atob(padded));
    return {
      answer: Number(data.answer ?? Number.NaN),
      expiresAt: Number(data.expiresAt ?? 0)
    };
  } catch {
    return null;
  }
}

/** 返回用于访客频率限制的稳定哈希，且不存储原始 IP 地址。 */
async function createGuestAuthorHash(request: Request, env: Env) {
  const ip = request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For") ?? "unknown";
  return sign(`guestbook:${ip}`, env.SESSION_SECRET);
}

/** 计算访客再次发帖前还需等待的秒数。 */
async function remainingGuestWaitSeconds(db: D1Database, authorHash: string) {
  const latest = await db
    .prepare(
      `
        SELECT created_at
        FROM guestbook_messages
        WHERE author_hash = ?
        ORDER BY datetime(created_at) DESC
        LIMIT 1
      `
    )
    .bind(authorHash)
    .first<{ created_at: string }>();

  if (!latest?.created_at) {
    return 0;
  }

  return remainingCooldownSeconds(new Date(`${latest.created_at}Z`).getTime(), Date.now());
}

/** 根据两个时间戳计算前后端共用的冷却时间。 */
export function remainingCooldownSeconds(lastCreatedAt: number, now: number) {
  const elapsedSeconds = Math.floor((now - lastCreatedAt) / 1000);
  return Math.max(0, guestMessageIntervalSeconds - elapsedSeconds);
}

export function normalizedTags(tags: string[]) {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 12);
}

export function slugify(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "article";
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError("BAD_REQUEST", "请求体必须是合法 JSON", 400);
  }
}

async function requireAuth(request: Request, env: Env) {
  if (!(await isAuthenticated(request, env))) {
    throw new ApiError("FORBIDDEN", "请先登录", 403);
  }
}

function getAuthConfig(env: Env): AuthConfig | null {
  const username = String(env.ADMIN_USERNAME ?? "");
  const password = String(env.ADMIN_PASSWORD ?? "");
  const sessionSecret = String(env.SESSION_SECRET ?? "");

  if (!username || !password || !sessionSecret) {
    return null;
  }

  return {
    username,
    password,
    sessionSecret
  };
}

async function isAuthenticated(request: Request, env: Env) {
  const authConfig = getAuthConfig(env);
  if (!authConfig) {
    return false;
  }

  const cookie = getCookie(request, sessionCookieName);
  if (!cookie) {
    return false;
  }

  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) {
    return false;
  }

  const expected = await sign(payload, authConfig.sessionSecret);
  if (!safeEqual(signature, expected)) {
    return false;
  }

  const session = decodePayload(payload);
  return Boolean(session?.username === authConfig.username && session.expiresAt > Date.now());
}

async function createSessionCookie(request: Request, authConfig: AuthConfig) {
  const payload = encodePayload({
    username: authConfig.username,
    expiresAt: Date.now() + oneWeekSeconds * 1000
  });
  const signature = await sign(payload, authConfig.sessionSecret);
  return `${sessionCookieName}=${payload}.${signature}; ${cookieAttributes(request)} Max-Age=${oneWeekSeconds}`;
}

function cookieAttributes(request: Request) {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" ? "Secure; " : "";
  return `HttpOnly; ${secure}SameSite=Lax; Path=/;`;
}

function encodePayload(value: Record<string, unknown>) {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodePayload(payload: string): { username: string; expiresAt: number } | null {
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const data = JSON.parse(atob(padded));
    return {
      username: String(data.username ?? ""),
      expiresAt: Number(data.expiresAt ?? 0)
    };
  } catch {
    return null;
  }
}

async function sign(value: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64Url(new Uint8Array(signature));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function getCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const cookies = cookieHeader.split(";").map((part) => part.trim());

  for (const cookie of cookies) {
    const [key, ...value] = cookie.split("=");
    if (key === name) {
      return value.join("=");
    }
  }

  return "";
}

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new ApiError("BAD_REQUEST", "URL 路径格式不正确", 400);
  }
}

/** 解析正整数查询参数，并提供安全的兜底值。 */
function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/** 创建不可缓存的 JSON API 响应，同时保留调用方的状态码和请求头。 */
export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers); // 在应用 API 默认值前，归一化所有受支持的 HeadersInit 形式。
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");

  return new Response(JSON.stringify(data), {
    ...init,
    headers
  });
}

function parseOptionalPositiveInteger(value: string | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError("BAD_REQUEST", "文章 ID 不正确", 400);
  }
  return parsed;
}

function jsonError(code: ApiErrorCode, message: string, status: number) {
  return json({ error: { code, message } }, { status });
}

class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
