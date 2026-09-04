import { Fragment, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCcw, Search } from "lucide-react";
import { listArticleViewStatistics } from "./api";
import { deviceTypeLabel, emptyStatisticsFilters, formatStatisticsTime } from "./statistics";
import type { ArticleViewRecord, ArticleViewStatisticsResponse, StatisticsFilters } from "./types";

/** 渲染文章访问的管理员筛选项、结果与分页。 */
export function StatisticsPage() {
  const [draftFilters, setDraftFilters] = useState<StatisticsFilters>({ ...emptyStatisticsFilters });
  const [filters, setFilters] = useState<StatisticsFilters>({ ...emptyStatisticsFilters });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ArticleViewStatisticsResponse | null>(null);
  const [articleOptions, setArticleOptions] = useState<Array<{ slug: string; title: string }>>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0); // 单调递增的标识，用于丢弃过期的请求结果。

  useEffect(() => {
    const requestId = requestIdRef.current + 1; // 本次筛选/分页请求所拥有的标识。
    let active = true; // 防止该请求在其 effect 被销毁后仍更新状态。
    requestIdRef.current = requestId;
    setLoading(true);
    setError("");
    setResult(null);
    setExpandedIds(new Set());

    void listArticleViewStatistics(filters, page)
      .then((nextResult) => {
        if (!active || requestId !== requestIdRef.current) return;
        setResult(nextResult);
        setArticleOptions(nextResult.articles);
      })
      .catch((caught: unknown) => {
        if (!active || requestId !== requestIdRef.current) return;
        setError(caught instanceof Error ? caught.message : "统计数据加载失败");
      })
      .finally(() => {
        if (active && requestId === requestIdRef.current) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters, page]);

  /** 更新单个受控的草稿筛选项，在提交前不发起查询。 */
  function setFilter<Key extends keyof StatisticsFilters>(key: Key, value: StatisticsFilters[Key]) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  /** 应用草稿筛选项的快照，并将分页重置到第一页。 */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setFilters({ ...draftFilters });
  }

  /** 清空草稿与已应用的筛选项，使用全新对象以便重新执行空查询。 */
  function reset() {
    const empty = { ...emptyStatisticsFilters }; // 全新的筛选状态，同时触发第一页的重新拉取。
    setDraftFilters(empty);
    setPage(1);
    setFilters({ ...empty });
  }

  /** 切换某条访问记录的完整 User-Agent 行显示。 */
  function toggleAgent(id: number) {
    setExpandedIds((current) => {
      const next = new Set(current); // React 检测状态变化所需的独立集合。
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="statistics-page">
      <div className="statistics-heading">
        <div>
          <h1>访问统计</h1>
          <p>{result ? `共 ${result.total} 条访问记录` : loading ? "正在查询访问记录" : "访问记录查询"}</p>
        </div>
      </div>

      <form className="statistics-filter-form" onSubmit={submit}>
        <label>
          文章
          <select value={draftFilters.article} onChange={(event) => setFilter("article", event.target.value)}>
            <option value="">全部文章</option>
            {articleOptions.map((article) => (
              <option value={article.slug} key={article.slug}>
                {article.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          IP
          <input
            maxLength={120}
            value={draftFilters.ip}
            onChange={(event) => setFilter("ip", event.target.value)}
            placeholder="完整 IP 或片段"
          />
        </label>
        <label>
          设备 / 系统 / 浏览器
          <input
            maxLength={200}
            value={draftFilters.device}
            onChange={(event) => setFilter("device", event.target.value)}
            placeholder="例如 Chrome、iOS"
          />
        </label>
        <label>
          开始日期
          <input
            type="date"
            max={draftFilters.to || undefined}
            value={draftFilters.from}
            onChange={(event) => setFilter("from", event.target.value)}
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            min={draftFilters.from || undefined}
            value={draftFilters.to}
            onChange={(event) => setFilter("to", event.target.value)}
          />
        </label>
        <div className="statistics-filter-actions">
          <button className="text-button primary" type="submit" disabled={loading}>
            <Search size={16} aria-hidden="true" />
            查询
          </button>
          <button
            className="icon-button subtle"
            type="button"
            onClick={reset}
            disabled={loading}
            title="重置查询"
            aria-label="重置查询"
          >
            <RotateCcw size={17} aria-hidden="true" />
          </button>
        </div>
      </form>

      {loading && (
        <div className="statistics-loading" role="status" aria-live="polite">
          <span className="button-spinner" aria-hidden="true" />
          正在加载访问记录...
        </div>
      )}
      {!loading && error && (
        <div className="statistics-state statistics-error" role="alert">
          <h2>统计数据加载失败</h2>
          <p>{error}</p>
        </div>
      )}
      {!loading && !error && result && result.records.length === 0 && (
        <div className="statistics-state statistics-empty">
          <h2>没有匹配的访问记录</h2>
        </div>
      )}
      {!loading && !error && result && result.records.length > 0 && (
        <StatisticsResultsTable records={result.records} expandedIds={expandedIds} onToggle={toggleAgent} />
      )}

      {!loading && !error && result && result.total > 0 && (
        <nav className="statistics-pagination" aria-label="访问记录分页">
          <button
            className="icon-button subtle"
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={result.page <= 1}
            title="上一页"
            aria-label="上一页"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <span>第 {result.page} 页</span>
          <button
            className="icon-button subtle"
            type="button"
            onClick={() => setPage((current) => current + 1)}
            disabled={!result.hasMore}
            title="下一页"
            aria-label="下一页"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
}

/** 以语义化表格渲染访问记录，并可选展开原始 User-Agent 行。 */
export function StatisticsResultsTable(props: {
  records: ArticleViewRecord[];
  expandedIds: Set<number>;
  onToggle: (id: number) => void;
}) {
  return (
    <div className="statistics-table-wrap">
      <table className="statistics-table">
        <thead>
          <tr>
            <th scope="col">访问时间</th>
            <th scope="col">文章</th>
            <th scope="col">IP</th>
            <th scope="col">设备</th>
            <th scope="col">操作系统</th>
            <th scope="col">浏览器</th>
            <th scope="col">User-Agent</th>
          </tr>
        </thead>
        <tbody>
          {props.records.map((record) => {
            const expanded = props.expandedIds.has(record.id); // 原始 User-Agent 行当前是否可见。
            const userAgent = record.userAgent || "unknown"; // 存储的 User-Agent 为空时的安全展示兜底值。
            const toggleLabel = expanded ? "收起 User-Agent" : "展开 User-Agent"; // 无障碍图标按钮名称。
            const userAgentId = `statistics-user-agent-${record.id}`; // 展开/收起控件的稳定目标 id。
            return (
              <Fragment key={record.id}>
                <tr>
                  <td>{formatStatisticsTime(record.viewedAt)}</td>
                  <td title={record.articleTitle}>{record.articleTitle}</td>
                  <td>{record.ipAddress}</td>
                  <td>{deviceTypeLabel(record.deviceType)}</td>
                  <td>{record.osName}</td>
                  <td>{record.browserName}</td>
                  <td>
                    <div className="statistics-user-agent">
                      <span className="statistics-user-agent-text">{userAgent}</span>
                      <button
                        className="icon-button subtle statistics-agent-toggle"
                        type="button"
                        onClick={() => props.onToggle(record.id)}
                        title={toggleLabel}
                        aria-label={toggleLabel}
                        aria-expanded={expanded}
                        aria-controls={expanded ? userAgentId : undefined}
                      >
                        {expanded ? (
                          <ChevronUp size={16} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={16} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
                {expanded && (
                  <tr className="statistics-expanded-agent">
                    <td id={userAgentId} colSpan={7}>{userAgent}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
