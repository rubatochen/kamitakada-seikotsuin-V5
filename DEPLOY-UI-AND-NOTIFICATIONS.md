# 上高田整骨院：预约及通知修复版（2026-10）

## 部署

1. 将此包的代码提交至原 GitHub 仓库，使用现有 Cloudflare Workers 构建配置部署。保留原 D1 `DB` binding 和现有 `ADMIN_PASSWORD` Worker **runtime secret**。
2. **无需修改 D1 表结构，也无需运行 SQL migration。** 通知日志使用已有 `settings` 表中 `reservation_event:` 前缀的行（不含姓名电话等敏感信息），每次有新预约事件时清理超过 14 天的旧日志，并只查询最近 14 天的事件；新增通知端点需要 Worker Functions 正常构建和发布。
3. 登录 `/admin`，点击 **「音声通知を有効にする」**，使该标签页能够播报。工作电脑浏览器标签页需保持打开，电脑不可休眠；约每 30 秒检查新事件。不保证浏览器关闭时即时通知。
4. 使用 `/reserve` 验证填写预约时间后切换延长分钟数，时间仍在；若延长后冲突则会提示重选，并保留客户资料。
5. 使用测试时间进行创建、取消和改期验证后，取消测试预约。建议先部署到 Cloudflare 预览环境验证，确认后再正式部署。

## 修复项

- 分钟级时间输入保持不变，延长选项重新拉取时间后，不再无条件清除已选时刻；服务器冲突时保留姓名/电话/备注。
- 公开 `/api/availability` 仅返回可预约状态与匿名占用时段，不再输出任何预约对象、姓名、ID、电话。
- `holidays` 表现在参与 `buildSlots()` 和公开日历闭店状态判断。
- 新建和修改预约使用原子性 `INSERT SELECT WHERE NOT EXISTS` / `UPDATE ... WHERE NOT EXISTS`，避免并发请求在不同分钟重叠预约。仍保持 1 分钟粒度、预约占用 30/40/50/60 分钟。
- 工作人员后台仅加载当前选中日期的预约和当天临时休息，不再每分钟返回全部历史预约；原导出功能保持不变。
- 工作人员登录后可手动开启日语/中文语音提醒，播报新预约、取消、日期时间变更，不播姓名。首次开启以当前事件为基准，防止历史预约轰炸；同一浏览器留存游标，最多补播 14 天内遗漏的通知。
- 取消/改期事件通过 `settings` 现有表写入，与预约更新在一个 D1 batch 事务中；不会改变原来的 `appointments` 和 UNIQUE INDEX。
- 首页大图改为压缩 WebP 减少下载量，日间和夜间外观保留；预约规则与既有自助改期功能说明一致。

## 限制及注意

- Web Speech API 受浏览器语音、音量、自动播放策略与系统睡眠影响。关闭网页或电脑后不会实时语音提醒。需要打开后台并点击启用一次。
- 首次在某个浏览器打开时不补播此前发生的预约；只有建立初始基线后才能补报遗漏事件。事件日志最多保留 14 天。
- `settings` 内的事件不存储顾客个人信息。原来的管理员 API 仍需要有效管理员 session。
- 未改动现有 Cookie／Secret／LINE／管理员登录及 D1 架构。部署后建议先做预览环境验收。

## 构建状态与发布提醒

当前交付环境中，尝试 `npx --yes wrangler@4 pages functions build --outdir=./dist/worker/` 时下载 Wrangler 超时；**没有取得 Wrangler 构建成功的结果**。
由于仓库使用自定义 `dist/worker/index.js` 作为 `wrangler.toml` 的 Worker `main`，已经直接更新这个入口的路由映射（包括 `/api/manage`、`/api/calendar`、`/api/admin/events`），保留原有 cron 清理逻辑。Node.js 语法检查、SQLite 冲突模拟、API/mock worker route 测试已通过；但这**不是 Cloudflare 线上构建或真实 D1 的验收**。

建议上传 GitHub 后先在 Cloudflare Preview 进行真实登录、预约、改期、取消和语音提醒测试，确认运行成功再部署生产环境。部署时 Cloudflare 需保留已有 Runtime Secret `ADMIN_PASSWORD` 和 DB binding，无需创建新密码。

## 本地验证结果

- `bash tests/verify-all.sh`：JS语法、预约相关SQL、防重叠、匿名信息保护、闭店日期、管理员通知权限、Worker入口 API 路由检查通过。
- Chromium 模拟页面交互：手机端选择加 30 分后保留已选 `17:00`；改为冲突时间会要求重选但保留已填姓名；管理员后台手动启用通知后能够播报取消事件（语音引擎已模拟，非真人设备声音检查）。
- 尚未完成真实 Cloudflare D1/Worker、跨设备浏览器声音、正式生产域名的端到端验收。
