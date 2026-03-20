import express from 'express';
import cors from 'cors';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import dotenv from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
dotenv.config();

const app = express();
app.use(cors({ origin: '*' })); // 生产时改成你的平台域名
app.use(express.json());

// Vercel 部署时请求路径带 /api 前缀，需剥离才能匹配路由
app.use((req, _res, next) => {
  if (req.path.startsWith('/api')) {
    req.url = req.url.replace(/^\/api/, '') || '/';
  }
  next();
});

// ========== 请求日志中间件（记录 headers key/value、query key/value） ==========
app.use((req, _res, next) => {
  const authHeader = req.headers.authorization;
  const tokenPassed = authHeader?.startsWith('Bearer ')
    ? `已传递 (${authHeader.slice(7, 20)}...)`
    : '未传递';

  const headerEntries = Object.entries(req.headers).map(([key, value]) => ({
    key,
    value: value ?? '',
  }));
  const queryEntries = Object.entries(req.query).map(([key, value]) => ({
    key,
    value: Array.isArray(value) ? value.join(',') : String(value ?? ''),
  }));

  const log: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    url: req.originalUrl,
    token: tokenPassed,
    headers: headerEntries,
    query: queryEntries,
  };
  if (req.body && Object.keys(req.body).length > 0) {
    log.body = req.body;
  }
  console.log('[MCP Request]', JSON.stringify(log, null, 2));
  next();
});

const MCP_RESOURCE = process.env.MCP_RESOURCE || 'http://localhost:8080';
const COGNITO_ISSUER = process.env.COGNITO_ISSUER || 'https://cognito.example.com';
const MOCK_MCP = process.env.MOCK_MCP === 'true' || !process.env.COGNITO_USER_POOL_ID;

// JWT 验证器（MOCK 模式下不初始化）
let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;
if (!MOCK_MCP) {
  verifier = CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID!,
    tokenUse: 'access',
    clientId: process.env.COGNITO_CLIENT_ID!,
  });
}

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      user?: { sub: string; email?: string; [key: string]: unknown };
    }
  }
}

// 全局认证中间件（MOCK 模式下跳过验证，否则校验 Cognito token）
const authenticateMCP = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  if (MOCK_MCP) {
    req.user = { sub: 'mock-user', email: 'mock@example.com' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res
      .status(401)
      .header(
        'WWW-Authenticate',
        `Bearer realm="mcp", resource_metadata="${MCP_RESOURCE}/.well-known/oauth-protected-resource"`
      )
      .json({ error: 'Missing Bearer token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = await verifier!.verify(token);
    req.user = payload as { sub: string; email?: string; [key: string]: unknown };
    next();
  } catch (err) {
    res
      .status(401)
      .header(
        'WWW-Authenticate',
        `Bearer realm="mcp", resource_metadata="${MCP_RESOURCE}/.well-known/oauth-protected-resource"`
      )
      .json({ error: 'Invalid/expired token' });
  }
};

// 【调试】健康检查 - 无需认证，用于验证服务是否可达
app.get('/', (_req, res) => {
  res.json({
    ok: true,
    message: 'MCP 服务运行中',
    mcp: `${MCP_RESOURCE}/mcp`,
    timestamp: new Date().toISOString(),
  });
});
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// 【必须】Protected Resource Metadata（MCP 规范强制要求）
app.get('/.well-known/oauth-protected-resource', (_req, res) => {
  res.json({
    resource: MCP_RESOURCE, // 必须是你的 MCP 根地址
    authorization_servers: [COGNITO_ISSUER],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'email', 'profile', 'mcp:tools'], // 你可以加自定义 scope
  });
});

// 【可选】直接重定向 Cognito 的 OpenID 配置
app.get('/.well-known/openid-configuration', (_req, res) => {
  res.redirect(`${COGNITO_ISSUER}/.well-known/openid-configuration`);
});

// ====================== 你的 MCP 工具接口（在这里"添加它"） ======================
// 下面是示例，你可以改成任何路径，只要加 authenticateMCP 就行

// 示例1：列出工具（你的平台可以 GET 这个）
app.get('/mcp/tools', authenticateMCP, (req, res) => {
  const user = req.user;
  res.json({
    tools: [
      {
        name: 'yourTool1',
        description: 'xxx',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      // ... 你所有的工具
    ],
  });
});

// 示例2：调用工具（你的平台 POST 这个）
app.post('/mcp/tools/call', authenticateMCP, (req, res) => {
  const { name, arguments: args } = req.body;
  const user = req.user;
  console.log(`用户 ${user?.email ?? user?.sub} 调用工具 ${name}`);

  // ←←← 这里写你的真实工具逻辑
  // if (name === 'yourTool1') { ... }

  res.json({ result: '工具执行成功', data: {} });
});

// ====================== 标准 MCP 协议端点（Streamable HTTP，供 Cursor/Claude 等客户端连接） ======================
const createMcpHandler = () => {
  const server = new McpServer(
    { name: 'mymcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  server.registerTool(
    'yourTool1',
    { description: '示例工具', inputSchema: z.object({}) },
    async () => ({
      content: [{ type: 'text', text: '工具执行成功' }],
    })
  );
  return server;
};

app.all('/mcp', authenticateMCP, async (req, res) => {
  const server = createMcpHandler();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // 无状态模式，适配 Vercel serverless
  });
  await server.connect(transport);
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[MCP]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  } finally {
    res.once('close', () => {
      transport.close();
      server.close();
    });
  }
});

// 导出 app 供 Vercel serverless 使用
export default app;

// 本地开发时启动服务（Vercel 环境下不执行）
const PORT = process.env.PORT || 8080;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 MCP 服务启动: ${MCP_RESOURCE}`);
    console.log(MOCK_MCP ? '⚠️ MOCK 模式（无 Cognito 验证）' : '✅ 已开启 Cognito Access Token 认证');
  });
}
