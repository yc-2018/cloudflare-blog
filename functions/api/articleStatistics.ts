import { UAParser } from "ua-parser-js";

export type ArticleViewDeviceType = "desktop" | "mobile" | "tablet" | "unknown";

export interface StatisticsFilters {
  article: string;
  ip: string;
  device: string;
  from: string;
  toExclusive: string;
  page: number;
}

const statisticsMaxPage = 1_000_000; // 管理员查询接受的最大页码。
const articleViewCooldownSeconds = 30 * 60; // 同一访客再次统计同一篇文章前的滚动冷却时间。
const statisticsPageSize = 20; // 每个管理员页面返回的文章浏览记录固定条数。

/** 管理员文章浏览记录所查询出的内部数据行。 */
interface ArticleViewQueryRow {
  id: number;
  slug: string;
  title: string;
  ip_address: string;
  user_agent: string;
  device_type: string;
  os_name: string;
  browser_name: string;
  viewed_at: string;
}

/** 标识无效的管理员统计查询参数。 */
export class StatisticsFilterError extends Error {}

/** 将原始 User-Agent 转换为随文章浏览一同存储的设备字段。 */
export function parseArticleViewDevice(userAgent: string) {
  if (!userAgent.trim()) {
    return { deviceType: "unknown" as const, osName: "unknown", browserName: "unknown" };
  }

  const result = new UAParser(userAgent).getResult();
  const parsedType = result.device.type;
  let deviceType: ArticleViewDeviceType;
  if (parsedType === "mobile" || parsedType === "tablet") {
    deviceType = parsedType;
  } else if (parsedType || (!result.browser.name && !result.os.name)) {
    deviceType = "unknown";
  } else {
    deviceType = "desktop";
  }
  return {
    deviceType,
    osName: joinAgentName(result.os.name, result.os.version),
    browserName: joinAgentName(result.browser.name, result.browser.version)
  };
}

/** 拼接解析出的代理名称与版本，同时保留明确的 unknown 值。 */
function joinAgentName(name?: string, version?: string) {
  return [name, version].filter(Boolean).join(" ") || "unknown";
}

/** 创建文章浏览冷却所使用的私密访客标识。 */
export async function articleViewVisitorHash(secret: string, ipAddress: string, userAgent: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const identity = `article-view:${ipAddress}\n${userAgent}`;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 转义用于 SQL LIKE 表达式的值，并显式使用反斜杠转义。 */
export function escapeStatisticsLike(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** 返回条件式访客占位所使用的冷却边界（含端点）。 */
export function articleViewCutoff(now: Date) {
  return toSqliteTimestamp(new Date(now.getTime() - articleViewCooldownSeconds * 1000));
}

/** 构建持久化浏览批处理失败后所使用的精确占位清理语句。 */
export function buildArticleViewClaimCleanup(articleId: number, visitorHash: string, countedAt: string) {
  return {
    sql: "DELETE FROM article_view_visitors WHERE article_id = ? AND visitor_hash = ? AND last_counted_at = ?",
    bindings: [articleId, visitorHash, countedAt]
  };
}

/** 构建带绑定参数的管理员筛选条件，不插入任何用户提供的值。 */
export function buildStatisticsWhere(filters: StatisticsFilters) {
  const clauses: string[] = [];
  const bindings: string[] = [];

  if (filters.article) {
    clauses.push("a.slug = ?");
    bindings.push(filters.article);
  }
  if (filters.ip) {
    clauses.push("av.ip_address LIKE ? ESCAPE '\\'");
    bindings.push(`%${escapeStatisticsLike(filters.ip)}%`);
  }
  if (filters.device) {
    const match = `%${escapeStatisticsLike(filters.device)}%`; // 所有设备字段共用的字面子串。
    clauses.push(
      "(av.device_type LIKE ? ESCAPE '\\' OR av.os_name LIKE ? ESCAPE '\\' OR av.browser_name LIKE ? ESCAPE '\\' OR av.user_agent LIKE ? ESCAPE '\\')"
    );
    bindings.push(match, match, match, match);
  }
  if (filters.from) {
    clauses.push("av.viewed_at >= ?");
    bindings.push(filters.from);
  }
  if (filters.toExclusive) {
    clauses.push("av.viewed_at < ?");
    bindings.push(filters.toExclusive);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", bindings };
}

/** 记录一次有效的文章浏览，并原子性地保持明细行与计数器一致。 */
export async function recordArticleView(
  db: D1Database,
  articleId: number,
  request: Request,
  secret: string,
  now = new Date()
) {
  const ipAddress =
    request.headers.get("CF-Connecting-IP")?.trim() ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";
  const userAgent = request.headers.get("User-Agent")?.trim() || "";
  const visitorHash = await articleViewVisitorHash(secret, ipAddress, userAgent);
  const countedAt = toSqliteTimestamp(now); // 冷却占位与持久化明细共用的同一时间戳。
  const claim = await db
    .prepare(
      `
        INSERT INTO article_view_visitors (article_id, visitor_hash, last_counted_at)
        VALUES (?, ?, ?)
        ON CONFLICT(article_id, visitor_hash) DO UPDATE SET last_counted_at = excluded.last_counted_at
        WHERE article_view_visitors.last_counted_at <= ?
        RETURNING article_id
      `
    )
    .bind(articleId, visitorHash, countedAt, articleViewCutoff(now))
    .first<{ article_id: number }>();

  if (!claim) return false;

  const device = parseArticleViewDevice(userAgent);
  try {
    await db.batch([
      db
        .prepare(
          `
            INSERT INTO article_views
              (article_id, ip_address, visitor_hash, user_agent, device_type, os_name, browser_name, viewed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .bind(
          articleId,
          ipAddress,
          visitorHash,
          userAgent,
          device.deviceType,
          device.osName,
          device.browserName,
          countedAt
        ),
      db.prepare("UPDATE articles SET view_count = view_count + 1 WHERE id = ?").bind(articleId)
    ]);
  } catch (error) {
    const cleanup = buildArticleViewClaimCleanup(articleId, visitorHash, countedAt);
    try {
      await db.prepare(cleanup.sql).bind(...cleanup.bindings).run();
    } catch (cleanupError) {
      console.error("Failed to compensate article view claim", cleanupError);
    }
    throw error;
  }
  return true;
}

/** 为已鉴权的管理员列出持久化的浏览明细和筛选选项。 */
export async function listArticleViewStatistics(db: D1Database, filters: StatisticsFilters) {
  const { where, bindings } = buildStatisticsWhere(filters);
  const offset = (filters.page - 1) * statisticsPageSize; // 到达所请求统计页前跳过的行数。
  const [count, records, articles] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS total FROM article_views av JOIN articles a ON a.id = av.article_id ${where}`)
      .bind(...bindings)
      .first<{ total: number }>(),
    db
      .prepare(
        `
          SELECT av.id, a.slug, a.title, av.ip_address, av.user_agent, av.device_type,
                 av.os_name, av.browser_name, av.viewed_at
          FROM article_views av
          JOIN articles a ON a.id = av.article_id
          ${where}
          ORDER BY av.viewed_at DESC, av.id DESC
          LIMIT ? OFFSET ?
        `
      )
      .bind(...bindings, statisticsPageSize, offset)
      .all<ArticleViewQueryRow>(),
    db.prepare("SELECT slug, title FROM articles ORDER BY lower(title), id").all<{ slug: string; title: string }>()
  ]);
  const total = Number(count?.total ?? 0); // 符合管理员筛选条件的记录总数。
  const resultRows = records.results ?? []; // D1 返回的当前页数据行。

  return {
    records: resultRows.map(formatArticleViewRecord),
    articles: articles.results ?? [],
    page: filters.page,
    limit: statisticsPageSize,
    total,
    hasMore: offset + resultRows.length < total
  };
}

/** 将内部 D1 数据行映射为管理员响应，且不暴露访客哈希。 */
export function formatArticleViewRecord(row: ArticleViewQueryRow) {
  const deviceType: ArticleViewDeviceType =
    row.device_type === "desktop" || row.device_type === "mobile" || row.device_type === "tablet"
      ? row.device_type
      : "unknown";

  return {
    id: row.id,
    articleSlug: row.slug,
    articleTitle: row.title,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    deviceType,
    osName: row.os_name,
    browserName: row.browser_name,
    viewedAt: row.viewed_at
  };
}

/** 将 Date 格式化为 SQLite 和 D1 使用的归一化 UTC 文本。 */
function toSqliteTimestamp(value: Date) {
  return value.toISOString().slice(0, 23).replace("T", " ");
}

/** 从请求 URL 校验并归一化管理员统计筛选条件。 */
export function parseStatisticsFilters(url: URL): StatisticsFilters {
  const article = boundedFilter(url.searchParams.get("article") ?? "", 200);
  const ip = boundedFilter(url.searchParams.get("ip") ?? "", 120);
  const device = boundedFilter(url.searchParams.get("device") ?? "", 200);
  const fromDate = parseDate(url.searchParams.get("from") ?? "");
  const toDate = parseDate(url.searchParams.get("to") ?? "");
  const toExclusiveDate = toDate ? nextUtcDay(toDate) : null;

  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw new StatisticsFilterError("开始日期不能晚于结束日期");
  }

  return {
    article,
    ip,
    device,
    from: fromDate ? sqliteDate(fromDate) : "",
    toExclusive: toExclusiveDate ? sqliteDate(toExclusiveDate) : "",
    page: positivePage(url.searchParams.get("page"))
  };
}

/** 去除文本筛选条件的首尾空白，并强制其存储安全的最大长度。 */
function boundedFilter(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new StatisticsFilterError("查询条件过长");
  }
  return trimmed;
}

/** 解析严格的 UTC 日历日期，不接受 JavaScript 的日期溢出。 */
function parseDate(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new StatisticsFilterError("日期格式不正确");
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new StatisticsFilterError("日期格式不正确");
  }
  return parsed;
}

/** 推进日期，同时保证 SQL 边界处于四位年份范围内。 */
function nextUtcDay(value: Date) {
  const next = new Date(value.getTime() + 86_400_000);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(next.toISOString())) {
    throw new StatisticsFilterError("日期格式不正确");
  }
  return next;
}

/** 格式化 UTC 日界，用于可按字典序排序的 D1 时间戳。 */
function sqliteDate(value: Date) {
  return `${value.toISOString().slice(0, 10)} 00:00:00`;
}

/** 返回从 1 开始的整数页码，输入无效时返回第一页。 */
function positivePage(value: string | null) {
  if (!value || !/^[0-9]+$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= statisticsMaxPage ? parsed : 1;
}
