import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { KnowledgeConfigurationError } from './knowledge.js';
async function main() {
  const config = loadConfig(process.env);
  const app = await buildApp(config);
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => process.exit(1), config.SHUTDOWN_TIMEOUT_MS);
    deadline.unref();
    try { await app.close(); clearTimeout(deadline); } catch { process.exitCode = 1; }
  };
  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}
main().catch(error => { console.error(error instanceof KnowledgeConfigurationError ? error.message : 'PersonaCore startup failed. Check configured environment fields and KNOWLEDGE_DIR/pack.json; no secret/provider details are logged.'); process.exitCode = 1; });
