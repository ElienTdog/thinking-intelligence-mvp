# Tools

本目录保存思考情报工作区的本地辅助命令。

## thinking_steward.py

无依赖 Python CLI。

```bash
python3 tools/thinking_steward.py workbench
python3 tools/thinking_steward.py status
python3 tools/thinking_steward.py today
python3 tools/thinking_steward.py flow
python3 tools/thinking_steward.py user-prompt
python3 tools/thinking_steward.py signal-brief
python3 tools/thinking_steward.py source-radar
python3 tools/thinking_steward.py mvp-audit
python3 tools/thinking_steward.py wiki-migrate
python3 tools/thinking_steward.py wiki-migrate --write
python3 tools/thinking_steward.py wiki-capture-lead --title "..." --url "https://..." --source "AI HOT" --write
python3 tools/thinking_steward.py wiki-lint
DEEPSEEK_API_KEY=... python3 tools/aihot_wiki_deepseek.py --write
python3 tools/wiki_inbox_sync.py --server "https://your-private-thinking-site.example" --token "wiki_..." --configure
python3 tools/wiki_inbox_sync.py --server "https://your-private-thinking-site.example"
python3 tools/wechat_capture_bridge.py --show-token
python3 tools/wiki_deepseek_maintainer.py --limit 10 --target-units 10
bash tools/install_wiki_sync_launch_agent.sh "https://your-private-thinking-site.example"
\# Make DeepSeek maintain new Web Clipper articles at login and each morning.
bash tools/install_wiki_deepseek_maintainer_launch_agent.sh
python3 tools/thinking_steward.py thoughts
python3 tools/thinking_steward.py capture-thought --text "..."
python3 tools/thinking_steward.py capture-use-case --task "..." --question Q1
python3 tools/thinking_steward.py use-cases --question Q1
python3 tools/thinking_steward.py method-from-use-case --question Q1
python3 tools/thinking_steward.py methods --question Q1
python3 tools/thinking_steward.py review-queue
python3 tools/thinking_steward.py review-queue --compact
python3 tools/thinking_steward.py dashboard
python3 tools/thinking_steward.py export-dashboard
python3 tools/thinking_steward.py next --question Q2
python3 tools/thinking_steward.py watchlist --question Q2
python3 tools/thinking_steward.py scout --question Q2
python3 tools/thinking_steward.py start-scout --question Q2
python3 tools/thinking_steward.py scouts
python3 tools/thinking_steward.py collect-plan --question Q2
python3 tools/thinking_steward.py research-task --question Q2
python3 tools/thinking_steward.py start-collect-plan --question Q2
python3 tools/thinking_steward.py collect-plans --question Q2
python3 tools/thinking_steward.py capture-source --question Q2 --title "source title" --url "https://example.com"
python3 tools/thinking_steward.py inbox --question Q2
python3 tools/thinking_steward.py card-from-source --question Q2 --dry-run
python3 tools/thinking_steward.py cards --question Q2
python3 tools/thinking_steward.py quality --question Q2
python3 tools/thinking_steward.py evidence-audit --question Q2
python3 tools/thinking_steward.py practice --card thinking/cards/card-name.md
python3 tools/thinking_steward.py start-practice --card thinking/cards/card-name.md
python3 tools/thinking_steward.py practices --question Q2
python3 tools/thinking_steward.py practice-answer --question Q2 --answer "..." --self-review "..." --write
python3 tools/thinking_steward.py daily-brief
python3 tools/thinking_steward.py start-brief
python3 tools/thinking_steward.py briefs
python3 tools/thinking_steward.py brief --question Q2
python3 tools/thinking_steward.py start-run --question Q2
python3 tools/thinking_steward.py runs
python3 tools/thinking_steward.py review --question Q2
python3 tools/thinking_steward.py review-coach --question Q2
python3 tools/thinking_steward.py start-review-coach --question Q2
python3 tools/thinking_steward.py coach-sessions --question Q2
python3 tools/thinking_steward.py review-fill --question Q2
python3 tools/thinking_steward.py review-workshop --question Q2
python3 tools/thinking_steward.py review-choices --question Q2
python3 tools/thinking_steward.py review-queue
python3 tools/thinking_steward.py review-queue --compact
python3 tools/thinking_steward.py review-answer --question Q2 --absorbed "..." --move "..." --doubt "..." --write
python3 tools/thinking_steward.py review-reply --text "Q2-A：...\nQ2-M：...\nQ2-D：..." --write
python3 tools/thinking_steward.py review-close --text "Q2-A：...\nQ2-M：...\nQ2-D：..." --write
python3 tools/thinking_steward.py start-review-workshop --question Q2
python3 tools/thinking_steward.py confirm-review --question Q2
python3 tools/thinking_steward.py stance-draft --question Q2
python3 tools/thinking_steward.py start-review --question Q2
python3 tools/thinking_steward.py reviews
python3 tools/thinking_steward.py lint
```

- `workbench`：统一第一屏，聚合当前优先、用户回复卡、主动搜集雷达、MVP 验收和推荐命令。
- `status`：查看当前问题、来源、收件箱、卡片和立场页数量。
- `today`：生成日常命令中心，把当前优先、不要做什么、质量门、证据提醒和下一步给 AI 的提示集中展示。
- `flow`：查看每个问题从初始判断、搜集、转卡、复盘、立场到练习的闭环健康状态。
- `user-prompt`：生成下一句应该向用户索取什么的短提示，适合直接贴进对话。
- `signal-brief`：从面试官/产品视角，把当前材料翻译成能被看见的思考信号。
- `source-radar`：查看所有 active question 的主动扫描状态、来源路线、高信号标准和暂停原因。
- `mvp-audit`：按目标问题验收当前工作区是否真的证明 MVP 可用，并列出未闭环项。
- `wiki-migrate`：把旧来源索引迁到 `wiki/01 原始材料`，把旧 thinking card 迁到 `wiki/03 主题与主张`；默认只预览，`--write` 才会写入。迁入页保留“待原文复核”状态，不会把旧摘要冒充成已验证正文。
- `wiki-capture-lead`：把 AI HOT 或雷达发现的线索写入 `wiki/01 原始材料/AI HOT 线索`。它始终标为 `lead；原文待核验`，不会自动更新主题、问题或我的判断。
- `wiki-lint`：检查 `wiki/` 的系统文件、来源元数据和主题页的主张/边界/验证结构。
- `aihot_wiki_deepseek.py`：用 DeepSeek 对 AI HOT 24 小时精选做开放主题筛选，并以 `lead；原文待核验` 写入 `wiki/01 原始材料/AI HOT 线索`。带 `links.original` 的候选会同时进入 `wiki/00 系统/aihot-discovery-inbox.json`，等待正文抓取。它不受 Q1/Q2 review 状态限制，不会把摘要当正文，也不会自动改写主题或“我的判断”；密钥优先从 `DEEPSEEK_API_KEY` 读取，否则读取 macOS 钥匙串中服务名为 `thinking-wiki-deepseek` 的条目。
- `wechat_capture_bridge.py`：只监听 `127.0.0.1:8765` 的本地采集桥。它以随机钥匙串令牌、微信 URL allowlist、URL 哈希幂等和加载超时连接浏览器扩展；不读取 Cookie、浏览器 profile，也不绕过登录或验证。
- `web/capture-bridge-extension/`：Chrome/Edge 的本地解压扩展。首次加载后，在扩展选项里粘贴 `python3 tools/wechat_capture_bridge.py --show-token` 显示的令牌；之后它只提取用户浏览器中正常可见的公众号正文与图片。
- `wiki_inbox_sync.py`：从在线收件箱和 AI HOT 本地发现队列取回链接，调用本地浏览器采集桥，把可读正文和校验通过的图片写入 `wiki/01 原始材料`，再让 DeepSeek 维护并镜像线上。AI HOT 线索页不会被误判成已抓正文；受限页停在“需用户打开”，不会生成知识页或推荐卡。
- `wiki_deepseek_maintainer.py`：扫描尚未维护的可读原始材料，用 DeepSeek API 为每篇文章生成 3-6 个可独立阅读的知识单元和一页“来源解读”，并按需更新 `02`-`05`、`index.md` 和 `log.md`。默认以每轮至少 10 个知识单元为目标、最多处理 10 篇；正文不足时如实记录缺口，不用摘要或虚构内容补数。状态文件会记录模型、API 调用次数与 token 用量；`--limit 0` 可补处理全部，`--force` 可重新维护，`--reindex` 可重建索引入口。它永不改写原文、`06 我的判断` 或 `07 练习与案例`。
- `install_wiki_sync_launch_agent.sh`：预检同步、私有站点和 DeepSeek 钥匙串后，安装常驻采集桥与每 120 秒运行一次的收件箱同步 LaunchAgent。
- `install_wiki_deepseek_maintainer_launch_agent.sh`：安装登录即运行、每天 09:10 运行一次的本机维护任务。它每次让 DeepSeek 以 10 个知识单元为目标、最多处理 10 篇新原文；日志写到 `.logs/`，密钥始终只从钥匙串读取。

### DeepSeek 密钥

定时任务不会继承普通终端的环境变量时，在“钥匙串访问”中创建一个 **通用密码**：名称填 `thinking-wiki-deepseek`，密码填 DeepSeek API Key。不要把密钥写进 `wiki/`、`.md`、自动化提示词或 Git。入库器会优先读环境变量，再读这个专用钥匙串条目。
- `thoughts`：查看用户自己的原始想法收件箱。
- `capture-thought`：低摩擦记录一句原始想法，可选关联 active question。
- `capture-use-case`：记录一次真实 AI 使用样本，包括上下文、AI 角色、人类判断、验证方式、结果和边界。
- `use-cases`：列出已保存的个人 AI 使用样本。
- `method-from-use-case`：从真实 use case 提炼一张 personal AI method card。
- `methods`：列出已保存的 AI 使用方法论卡片。
- `review-queue`：把所有待处理 review 集中成 A/M/D 三句话确认队列。
- `dashboard`：按下一步优先级查看当前问题。
- `export-dashboard`：导出本地 HTML 训练台，并同时生成 `thinking/understanding-map-demo.html`。关注作者阅读只展示卡兹克、赛博禅心和 MacTalk 的已核验材料；缺少正文时明确留空，不用其他热点补位，也不写入 Markdown。
- `next`：查看某个问题当前最该做什么。
- `watchlist`：查看长期思想来源雷达。
- `scout`：为某个问题生成搜集雷达。
- `start-scout`：保存搜集雷达。
- `scouts`：列出已保存的搜集雷达。
- `collect-plan`：生成带启动闸门、搜集配额和完成标准的主动搜集计划。
- `research-task`：生成可直接交给 AI 联网执行的搜集任务包，并在 review 未完成时阻止继续搜。
- `start-collect-plan`：保存主动搜集计划。
- `collect-plans`：列出已保存的主动搜集计划。
- `capture-source`：把一个候选外部来源收进 inbox。
- `inbox`：列出候选来源收件箱。
- `card-from-source`：从 inbox 来源生成 thinking card 草稿。
- `cards`：列出已有 thinking cards。
- `quality`：审查 inbox 来源和 thinking card 的证据、主张、思考动作与红旗。
- `evidence-audit`：审计来源链接、发布时间、新鲜度和是否需要联网复核。
- `practice`：从 thinking card 打印一份可作答练习。
- `start-practice`：保存思考练习。
- `practices`：列出已有思考练习。
- `practice-answer`：把用户的练习作答和自评写回 practice，并把状态改成 answered。
- `daily-brief`：根据当前工作区状态生成思考简报。
- `start-brief`：保存思考简报。
- `briefs`：列出已保存的思考简报。
- `brief`：在联网搜集前生成本轮任务说明，并检查是否已有初始判断。
- `start-run`：创建一条本轮搜集运行记录。
- `runs`：列出已有运行记录。
- `review`：根据最新或指定运行记录打印复盘提示。
- `review-coach`：根据 draft review、卡片和练习生成复盘作答支架。
- `start-review-coach`：保存复盘教练记录。
- `coach-sessions`：列出已有复盘教练记录。
- `review-fill`：把复盘教练支架转成待用户确认的 review 草稿。
- `review-workshop`：把待确认 review 草稿拆成采用、保留怀疑、删除和“我的表达”的吸收工作台。
- `review-choices`：把待确认 review 草稿压成 A/M/D 三组短候选，方便在对话里快速选择和改写。
- `review-queue`：集中展示所有 active question 的待确认 review、候选 A/M/D 和写回模板；`--compact` 输出可直接发给用户回复的短确认卡。
- `review-answer`：把用户明确确认后的吸收、思考动作和怀疑写回复盘草稿，并勾选确认项。
- `review-reply`：解析 `Q1-A/Q1-M/Q1-D` 形式的对话回复，批量写回对应待确认 review；默认 dry-run，`--write` 才落盘。
- `review-close`：解析用户 A/M/D 回复，预检通过后一次性写回 review、标记 reviewed，并追加 stance 更新；默认 dry-run，`--write` 才落盘。
- `start-review-workshop`：保存复盘吸收工作台。
- `confirm-review`：校验待确认复盘草稿，只有用户删改并勾选确认后才允许标成 reviewed。
- `stance-draft`：从 reviewed review 生成 stance page 更新草稿，或把变化记录追加到立场页；重复执行不会重复追加同一份 review。
- `start-review`：创建复盘记录。
- `reviews`：列出已有复盘记录。
- `lint`：检查结构完整性，避免卡片缺少来源、初始判断、推理路径或追问。
