# mymcp

Jacky's MCP 服务 - 支持 Cognito SSO 认证（符合 MCP 官方规范 + RFC 9728）

## 认证链路

```
平台（SSO 登录 Cognito → 拿到 access token）
  → HTTP 请求 MCP 服务
  → 把 token 放在 Authorization: Bearer <token> header 里
  → MCP 服务验证通过后返回工具结果
```

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入你的 Cognito 配置
```

### 2. 本地开发

```bash
npm install
npm run dev
```

### 3. 测试

```bash
# 列出工具（需要有效的 Cognito access token）
curl -H "Authorization: Bearer 你的cognito-access-token" http://localhost:8080/mcp/tools

# 调用工具
curl -X POST -H "Authorization: Bearer 你的token" \
  -H "Content-Type: application/json" \
  -d '{"name":"yourTool1","arguments":{}}' \
  http://localhost:8080/mcp/tools/call
```

## 请求日志

所有请求会自动记录到控制台，包含：`method`、`path`、`url`、`headers`、`body`。便于调试和对接平台。

## MOCK 模式

未配置 Cognito 或设置 `MOCK_MCP=true` 时，自动进入模拟模式：
- 跳过 token 校验
- 直接返回工具列表和 mock 结果
- 适合构建 MCP 时先拿到 URL 做对接测试

## 部署到 Vercel

```bash
# 1. 推送到 GitHub
git push

# 2. 在 Vercel 导入项目，一键部署

# 3. 环境变量（Vercel 控制台 → Settings → Environment Variables）
MCP_RESOURCE=https://你的项目.vercel.app
MOCK_MCP=true   # 模拟阶段可设为 true，正式用 Cognito 时删除或设为 false
```

部署后 MCP URL 为：`https://你的项目.vercel.app`（vercel.json 已配置 rewrite，根路径即 API）

## 其他部署

- **Railway / Render.com**：推 GitHub 一键部署
- **AWS Lambda + API Gateway**：用 Serverless Framework

部署后记得：
1. `MCP_RESOURCE` 改成云上 https 地址
2. 生产环境改 `cors({ origin: 'https://你的平台域名' })`

## 端点说明

| 路径 | 说明 |
|------|------|
| `GET /.well-known/oauth-protected-resource` | Protected Resource Metadata（MCP 规范强制） |
| `GET /.well-known/openid-configuration` | 重定向到 Cognito OpenID 配置 |
| `GET /mcp/tools` | 列出工具（需认证） |
| `POST /mcp/tools/call` | 调用工具（需认证） |

## 添加自定义工具

在 `server.ts` 的 `/mcp/tools` 和 `/mcp/tools/call` 路由中添加你的工具定义和逻辑。
