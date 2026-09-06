export const guestbookPath = "/guestbook"; // 留言板页面的可分享路径。

export const statisticsPath = "/statistics"; // 管理员访问统计的可分享路径。

export const trashPath = "/trash"; // 管理员文章回收站的可分享路径。

export const passwordQueryKey = "password"; // 密码文章分享链接使用的 URL 查询键。

export const articlesHash = "#articles"; // 直接打开文章列表的书签哈希。

/** 将文章 slug 编码为可分享的详情路径。 */
export function articlePath(slug: string) {
  return `/articles/${encodeURIComponent(slug)}`;
}

/** 从详情路径读取文章 slug，非法编码按非文章路径处理。 */
export function slugFromPath(pathname: string) {
  const match = pathname.match(/^\/articles\/(.+)$/);
  if (!match) {
    return "";
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}
