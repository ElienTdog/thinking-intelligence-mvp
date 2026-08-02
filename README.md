# 思考情报台

思考情报台是一个把“看过一条观点”变成“留下一个可回看的判断变化”的个人工作台。

它的核心闭环是：

```text
问题 → 外部材料或思考卡 → 用户回应 → 判断差分 → 真实场景验证（如需要）
```

它不把收藏数量当成进步，也不会自动把 AI 或外部材料升级为用户立场。

## MVP 1.0

`web/` 是可部署的私有 Alpha：

- ChatGPT 登录识别用户；
- D1 保存每个账户隔离的问题、材料与判断差分；
- 可以创建问题、添加来源或思考卡，并记录“部分接受 / 提出反驳 / 拿真实场景验证 / 暂存”；
- 验证型回应必须写验证场景，且不会自动改写临时立场。

## 公开代码与私有数据

本仓库是公开产品代码。个人的 Markdown vault 不在仓库内，根目录 `.gitignore` 会排除本地 `thinking/` 数据目录、导出页面、环境变量、依赖与构建产物。线上 Alpha 从空工作区开始，不会上传或同步本地材料。

可公开的脱敏数据说明见 [examples/private-alpha-data.md](examples/private-alpha-data.md)。

## 开发

```bash
cd web
npm install
npm run db:generate
npm test
npm run lint
npm run build
```

完整的 Web Alpha 数据边界与开发说明见 [web/README.md](web/README.md)。
