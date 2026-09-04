import type { ArticleViewRecord, StatisticsFilters } from "./types";

/** 默认筛选值；调用方在保存可变的表单状态前会先复制该对象。 */
export const emptyStatisticsFilters: StatisticsFilters = {
  article: "",
  ip: "",
  device: "",
  from: "",
  to: ""
};

const d1UtcTimestampPattern = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;
const isoTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))?$/;
const statisticsTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "medium"
});

/** 按 API 期望的顺序序列化当前生效的统计筛选项。 */
export function buildStatisticsSearch(filters: StatisticsFilters, page: number) {
  const params = new URLSearchParams();
  const ip = filters.ip.trim();
  const device = filters.device.trim();

  if (filters.article) params.set("article", filters.article);
  if (ip) params.set("ip", ip);
  if (device) params.set("device", device);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  params.set("page", String(page));
  return params.toString();
}

/** 将每种存储的设备类别映射为面向管理员的中文标签。 */
export function deviceTypeLabel(value: ArticleViewRecord["deviceType"]) {
  switch (value) {
    case "desktop":
      return "桌面设备";
    case "mobile":
      return "手机";
    case "tablet":
      return "平板";
    case "unknown":
      return "未知设备";
    default: {
      const exhaustiveValue: never = value;
      return exhaustiveValue;
    }
  }
}

/** 格式化 D1 UTC 时间戳以及带时区的 ISO 时间戳以供展示。 */
export function formatStatisticsTime(value: string) {
  const normalized = normalizeStatisticsTimestamp(value);
  if (!normalized) return "未知时间";
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return "未知时间";
  return statisticsTimeFormatter.format(parsed);
}

/** 校验可接受的时间戳字段，并返回无歧义的 ISO 值。 */
function normalizeStatisticsTimestamp(value: string) {
  const d1Match = d1UtcTimestampPattern.exec(value);
  const match = d1Match ?? isoTimestampPattern.exec(value);
  if (!match || !hasValidTimestampFields(match)) return null;

  const normalized = d1Match ? value.replace(" ", "T") : value;
  return match[8] ? normalized : `${normalized}Z`;
}

/** 拒绝那些 Date 本会自动归一化的日历、时钟和时区字段。 */
function hasValidTimestampFields(match: RegExpExecArray) {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1]) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[8] && match[8] !== "Z" && (Number(match[9]) > 23 || Number(match[10]) > 59)) return false;
  return true;
}
