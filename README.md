# Cloudflare Personal Blog

一个使用 Cloudflare 免费服务部署的简约个人博客：Cloudflare Pages 托管前端，Pages Functions 提供 API，D1 保存文章、标签和留言数据。

> Fork 后准备部署自己的实例？请阅读：[Cloudflare 快速部署指南](docs/CLOUDFLARE_DEPLOY.md)。

## 本地开发

### 第一次启动

第一次拉取项目，或者换一台新电脑开发时，按下面顺序执行。

1. 进入项目目录：

   ```bash
   cd cloudflare-blog
   ```

2. 安装依赖：

   ```bash
   pnpm install
   ```

3. 准备本地环境变量。如果仓库里已经有 `.dev.vars`，可以跳过这一步；如果没有，就复制示例文件：

   ```bash
   cp .dev.vars.example .dev.vars
   ```

   Windows PowerShell 也可以使用：

   ```powershell
   Copy-Item .dev.vars.example .dev.vars
   ```

4. 检查 `.dev.vars`。本地调试可以先使用默认值：

   ```env
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=change-me
   SESSION_SECRET=change-me-to-a-long-random-string
   IMGBB_API_KEY=你的 ImgBB API Key
   ```

   前三个值必须配置；`IMGBB_API_KEY` 只在本地测试图片上传时需要。这些默认值只适合本地临时调试。线上一定要在 Cloudflare Pages 里配置真实值，不要让线上继续使用 `change-me`。

5. 初始化本地 D1 数据库表结构：

   ```bash
   pnpm db:migrate:local
   ```

6. 写入本地示例文章。只需要第一次执行；如果以后不想重复插入示例数据，就不要再执行这一条：

   ```bash
   pnpm db:seed:local
   ```

7. 构建前端：

   ```bash
   pnpm build
   ```

8. 启动 Cloudflare Pages 本地预览：

   ```bash
   pnpm cf:dev
   ```

打开 Wrangler 输出的本地地址即可访问。

### 第二次及以后启动

如果依赖、数据库迁移和环境变量都已经准备过，日常启动只需要：

```bash
pnpm build
pnpm cf:dev
```

如果只是改前端页面，不需要 Pages Functions 和 D1，也可以用更快的 Vite 开发服务器：

```bash
pnpm dev
```

不过博客的登录、文章接口、留言和 D1 数据库依赖 Cloudflare Pages Functions，完整调试还是推荐使用：

```bash
pnpm build
pnpm cf:dev
```

### 什么时候需要重新执行其他命令

拉取代码后，如果 `package.json` 或 `pnpm-lock.yaml` 有变化，重新安装依赖：

```bash
pnpm install
```

拉取代码后，如果 `migrations/` 里新增了数据库迁移文件，更新本地 D1 表结构：

```bash
pnpm db:migrate:local
```

文章浏览统计依赖 `migrations/0007_article_view_statistics.sql`。更新到包含统计功能的版本后，启动完整本地预览前需要先执行上面的本地迁移命令。

如果想重置本地示例数据，先清理本地 D1 数据，再重新执行：

```bash
pnpm db:seed:local
```

## Cloudflare 线上部署

这个项目推荐部署到 Cloudflare Pages，项目名使用 `yc-blog`。Pages 负责托管前端，`functions/api/[[path]].ts` 会作为 Pages Functions 自动提供接口。

### 1. 准备仓库

把代码推送到 Cloudflare Pages 支持连接的 Git 仓库，例如 GitHub 或 GitLab。

如果代码只在 Gitee，需要先同步一份到 GitHub/GitLab，或者改用 Wrangler 手动上传部署。

### 2. 创建 D1 数据库

在本地项目目录登录 Cloudflare：

```bash
pnpm wrangler login
```

创建线上 D1 数据库：

```bash
pnpm wrangler d1 create cloudflare_blog
```

命令输出里会有类似这样的配置：

```toml
[[d1_databases]]
binding = "DB"
database_name = "cloudflare_blog"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把真实的 `database_id` 填入 `wrangler.toml`。`database_id` 不是密码，可以提交到仓库；真正不能公开的是管理员密码、`SESSION_SECRET` 和 Cloudflare API Token。

### 3. 应用线上数据库迁移

D1 创建后，把 `migrations/` 里的表结构应用到线上数据库：

```bash
pnpm db:migrate:remote
```

后续如果要改数据库结构，也是在 `migrations/` 里新增 SQL 文件，先本地执行：

```bash
pnpm db:migrate:local
```

确认没问题后再执行：

```bash
pnpm db:migrate:remote
```

文章浏览统计依赖 `migrations/0007_article_view_statistics.sql`。部署包含统计功能的代码前，应先确认该迁移已经应用到线上 D1；否则新代码无法正常读写浏览次数和访问明细。

线上已有文章时，迁移 SQL 要谨慎，优先使用 `ALTER TABLE ... ADD COLUMN` 这类不破坏数据的操作，避免直接 `DROP TABLE` 或删除数据。

### 4. 创建 Cloudflare Pages 项目

进入 Cloudflare Dashboard：

```text
Workers & Pages -> Create application -> Pages -> Connect to Git
```

选择你的仓库，然后填写：

```text
Project name: yc-blog
Production branch: main
Framework preset: None 或 React (Vite)
Build command: pnpm build
Build output directory: dist
Root directory: /
```

如果页面有 `Deploy command` 字段，说明你可能进到了 Workers 构建页面。这个项目优先使用 Pages；如果必须填写部署命令，可以使用：

```bash
npx wrangler pages deploy dist --project-name=yc-blog --branch=main
```

但常规 Pages Git 集成只需要配置构建命令和输出目录。

### 5. 配置环境变量和 Secret

进入 Pages 项目：

```text
Settings -> Variables and Secrets
```

添加生产环境变量：

```text
ADMIN_USERNAME = admin
ADMIN_PASSWORD = 你的线上管理员密码
SESSION_SECRET = 一串足够长的随机字符串
IMGBB_API_KEY = 你的 ImgBB API Key
```

建议把 `ADMIN_PASSWORD`、`SESSION_SECRET` 和 `IMGBB_API_KEY` 设置为 Secret。Secret 对代码来说和普通环境变量一样使用，但在 Cloudflare 后台不会明文展示。

图片上传默认使用 [ImgBB API](https://api.imgbb.com/)；登录 ImgBB 后可以免费生成 API Key。不要把 Key 写入代码、提交到 Git 仓库或放进前端环境变量。

可以用下面的命令生成 `SESSION_SECRET`：

```bash
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
```

修改 `SESSION_SECRET` 后，已经登录的浏览器会失效，需要重新登录，这是正常现象。

### 图片上传与图床回退

管理员在文章 Markdown 编辑框或“列表图片”输入框里粘贴图片时，浏览器会先处理图片，再调用 Pages Function 上传：

- Markdown 正文中的 PNG、JPEG 等静态图片会转换为 WebP，最长边限制为 2560px，质量为 0.86。
- “列表图片”封面会单独压缩为 WebP，最长边限制为 1600px，质量为 0.8，且不会放大原图。
- GIF 保留原格式，避免动画丢失。
- 转换后的图片最大为 10 MB。
- 图床顺序为 ImgBB、Pixhost。
- 某个图床失败后，浏览器会在 `localStorage` 记录失败时间，30 分钟内跳过该图床。
- Pages Function 只负责转发上传，D1 和项目仓库只保存图床返回的 URL，不保存图片文件。

ImgBB 需要配置 `IMGBB_API_KEY`。Pixhost 使用其[公开上传 API](https://pixhost.to/api/index.html#upload-image)，无需账号，作为 ImgBB 的匿名备用。

### 6. 绑定 D1 数据库

进入 Pages 项目：

```text
Settings -> Bindings -> Add -> D1 database
```

填写：

```text
Variable name: DB
D1 database: cloudflare_blog
```

保存后重新部署一次项目，让绑定和环境变量生效。

### 7. 首次访问

部署完成后访问 Cloudflare 分配的域名：

```text
https://yc-blog.pages.dev
```

使用 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录后，就可以新增、编辑、删除文章。

### 8. 后续更新

普通代码或样式修改：

```bash
git add .
git commit -m "Update blog"
git push
```

Cloudflare Pages 会自动重新构建和部署。

如果新增了数据库迁移文件，先执行：

```bash
pnpm db:migrate:remote
```

再推送代码，或者至少确保新代码上线前线上数据库已经具备需要的字段。

## 功能

- 首页直接展示文章，移动端自适应。
- 支持搜索标题、摘要和 Markdown 正文。
- 支持标签列表与标签筛选。
- 登录可见文章只有管理员登录后可见；密码可见文章不会出现在访客列表中。
- 密码文章支持 4 位字母数字密码、带密码分享链接和连续输错 5 次后封禁 IP 一小时。
- 登录后可新增、编辑、删除文章，支持多标签以及公开、登录可见、密码可见配置。
- Markdown 使用 GitHub 风格渲染，支持 GFM 表格、任务列表、代码块高亮和粘贴图片自动上传。

### 文章浏览统计

- 文章列表和文章详情的标题区域都会公开显示累计浏览次数。
- 同一篇文章、同一 IP 和同一 User-Agent 在滚动的 30 分钟内只计一次；超过 30 分钟后再次访问会重新计数。
- 已登录管理员查看文章时不计入浏览次数，也不会生成访问明细。
- 管理员在桌面端可以通过顶部导航中“留言板”左侧的“统计”入口查看访问明细；屏幕宽度小于等于 `820px` 时隐藏该入口。
- 统计页支持按文章、IP 片段、设备/浏览器/操作系统/User-Agent 关键词以及开始和结束日期查询，并支持分页浏览结果。日期条件按 UTC 日历日边界过滤，开始日和结束日都包含全天；表格中的访问时间会按浏览器本地时区显示。
- 每次有效访问会保存完整 IP、解析后的设备类型、操作系统、浏览器以及原始 User-Agent，只有管理员可以查询这些明细。访问记录没有自动过期机制，会在对应文章仍存在时持续保留；删除文章时，其访问明细和去重记录会通过外键级联一并删除。完整 IP 和设备信息属于可能识别访客的个人数据，部署者应根据适用法律和自己的隐私政策告知访客，并采取合适的访问控制和数据保护措施。

## 常用命令说明

这个项目里的 `pnpm db:migrate:local`、`pnpm cf:dev` 这类命令，不是 pnpm 自带的数据库命令，也不是系统里单独安装了一个叫 `db` 或 `cf` 的软件。

它们都定义在 `package.json` 的 `scripts` 里。pnpm 会读取这些脚本，例如：

```json
{
  "scripts": {
    "cf:dev": "wrangler pages dev dist --compatibility-date=2026-05-19",
    "db:migrate:local": "wrangler d1 migrations apply cloudflare_blog --local",
    "db:migrate:remote": "wrangler d1 migrations apply cloudflare_blog --remote",
    "db:seed:local": "wrangler d1 execute cloudflare_blog --local --file ./scripts/seed-local.sql"
  }
}
```

所以：

```bash
pnpm cf:dev
```

基本等于：

```bash
pnpm run cf:dev
```

再等于实际执行：

```bash
wrangler pages dev dist --compatibility-date=2026-05-19
```

pnpm 在执行 scripts 时会自动把 `node_modules/.bin` 加到命令查找路径里，所以只要执行过 `pnpm install`，项目依赖里的 `wrangler`、`vite`、`tsc` 这些命令就能直接在脚本里使用，不需要全局安装。

### `pnpm install`

安装 `package.json` 里声明的依赖。

这个项目的 Cloudflare 命令主要依赖 `wrangler`，它在 `devDependencies` 里。第一次拉代码、换电脑、或者依赖文件变化后，需要执行：

```bash
pnpm install
```

### D1、DB 和 `db` 分别是什么

`D1` 是 Cloudflare 提供的 SQL 数据库服务，可以把它理解成 Cloudflare 上的轻量数据库。

`DB` 是代码里使用的绑定名，在 `wrangler.toml` 里配置：

```toml
[[d1_databases]]
binding = "DB"
database_name = "cloudflare_blog"
database_id = "..."
```

后端函数里通过 `env.DB` 访问数据库。

`db:migrate:local` 里的 `db` 只是脚本名字的一部分，是为了让命令看起来有分类感。它不是一个数据库软件，也不是一个 npm 包。

### `pnpm build`

实际执行：

```bash
tsc -b && vite build
```

作用是先做 TypeScript 构建检查，再用 Vite 把前端打包到 `dist/` 目录。

Cloudflare Pages 部署时也会执行这个构建命令。

### `pnpm cf:dev`

实际执行：

```bash
wrangler pages dev dist --compatibility-date=2026-05-19
```

`cf` 是 Cloudflare 的缩写，只是脚本名字的一部分。`cf:dev` 整个才是脚本名，不是 `cf` 这个库下面的 `dev` 命令。

这个命令会用 Wrangler 在本地启动 Cloudflare Pages 预览：

- 静态页面来自 `dist/`
- API 来自 `functions/`
- 本地环境变量来自 `.dev.vars`
- 本地 D1 数据库由 Wrangler 管理

因为它读取的是 `dist/`，所以启动前通常要先执行：

```bash
pnpm build
```

### `pnpm db:migrate:local`

实际执行：

```bash
wrangler d1 migrations apply cloudflare_blog --local
```

意思是：把 `migrations/` 目录里的数据库结构变更应用到本地 D1 数据库。

Wrangler 的 D1 migrations 默认会读取项目目录下的 `migrations/` 文件夹，按文件名顺序执行还没执行过的 `.sql` 文件，例如：

```text
migrations/
0001_initial.sql
0002_article_cover_image.sql
0003_guestbook_messages.sql
0004_guestbook_reply_target.sql
0005_guestbook_moderation.sql
0006_password_articles.sql
0007_article_view_statistics.sql
```

执行过哪些迁移，D1 会记录在数据库里的 `d1_migrations` 表中。所以下次再执行时，只会应用还没应用过的新迁移。

`--local` 表示只改本地数据库，不会影响 Cloudflare 线上的 D1。

### `pnpm db:migrate:remote`

实际执行：

```bash
wrangler d1 migrations apply cloudflare_blog --remote
```

意思是：把 `migrations/` 目录里还没应用过的数据库结构变更，应用到 Cloudflare 线上的 D1 数据库。

这个命令会影响线上数据库结构，所以新增迁移文件后建议先跑：

```bash
pnpm db:migrate:local
```

本地确认没问题，再跑：

```bash
pnpm db:migrate:remote
```

注意：它同步的是数据库结构变更，不是把本地文章数据同步到线上。线上已有文章会继续留在线上，除非你的迁移 SQL 主动删除或覆盖数据。

### `pnpm db:seed:local`

实际执行：

```bash
wrangler d1 execute cloudflare_blog --local --file ./scripts/seed-local.sql
```

意思是：把 `scripts/seed-local.sql` 这个 SQL 文件执行到本地 D1 数据库里。

这个文件会插入几篇本地演示文章和标签，方便第一次启动后马上看到内容。它只作用于本地，因为命令里有 `--local`。

一般只在第一次初始化本地数据库时执行一次：

```bash
pnpm db:seed:local
```

线上不要随便执行 seed，除非你明确想把演示数据插入线上数据库。
