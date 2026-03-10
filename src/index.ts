import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createMcpServer } from './server/mcp-server.js';
import { createHttpServer } from './server/http-server.js';
import { migrate } from './db/migrate.js';
import { rateLimit } from './server/rate-limit.js';
import { logger } from './utils/logger.js';
import { getDb } from './db/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000');

// Run migrations + seed
migrate();
logger.info('server', 'Database migrated and seeded');

// HTTP Server (health, API)
const app = createHttpServer();
app.set('env', 'production');
app.use(express.json({ limit: '1mb' }));

// Handle JSON parse errors with a proper JSON-RPC error response
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error: Invalid JSON' },
      id: null,
    });
    return;
  }
  next(err);
});

// Rate limits: 120 MCP requests per minute, 30 API requests per minute
const mcpLimiter = rateLimit(120, 60_000);
const apiLimiter = rateLimit(30, 60_000);
app.use('/api', apiLimiter);

// Redirect /docs to /docs/ for clean URLs
app.get('/docs', (_req: express.Request, res: express.Response) => {
  res.redirect(301, '/docs/');
});

// Serve static frontend (after API routes registered in createHttpServer, before MCP)
app.use(express.static(path.join(__dirname, '..', 'public'), {
  extensions: ['html'],
}));

// POST /mcp — main MCP handler (stateless: new server per request)
app.post('/mcp', mcpLimiter, async (req: express.Request, res: express.Response) => {
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      server.close();
    });
  } catch (error: any) {
    logger.error('mcp', 'Request failed', { error: error.message });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// GET /mcp — not supported in stateless mode
app.get('/mcp', (_req: express.Request, res: express.Response) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'SSE not supported in stateless mode' },
    id: null,
  });
});

// DELETE /mcp — not supported in stateless mode
app.delete('/mcp', (_req: express.Request, res: express.Response) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Session termination not supported in stateless mode' },
    id: null,
  });
});

// Sanitize all error responses — never expose stack traces
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('http', 'Unhandled error', { error: err.message });
  if (!res.headersSent) {
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal server error' },
      id: null,
    });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info('server', `VibeTheWorld running on port ${PORT}`, { port: PORT });
  logger.info('server', `MCP endpoint: http://localhost:${PORT}/mcp`);
  logger.info('server', `Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
function shutdown() {
  logger.info('server', 'Shutting down gracefully...');
  server.close(() => {
    try { getDb().close(); } catch {}
    logger.info('server', 'Server stopped');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
