// 使用当前桌面版自带的已认证客户端，把原生会话导入明确选中的工作区。
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { readFileSync } = require('node:fs');
(async () => {
  const home = process.argv[2];
  const resources = process.resourcesPath || process.env.PASEO_DESKTOP_RESOURCES;
  if (!resources) throw new Error('需要 Paseo 桌面版自带的客户端');
  const base = join(resources, 'app.asar', 'node_modules', '@getpaseo', 'cli', 'dist');
  const { connectToDaemon } = await import(pathToFileURL(join(base, 'utils/client.js')).href);
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const client = await connectToDaemon({target: {kind: 'instance', home}});
  try {
    const agent = await client.importAgent(input);
    if (agent.workspaceId !== input.workspaceId) throw new Error('后台返回的工作区与目标不一致');
    process.stdout.write(JSON.stringify({id: agent.id}));
  } finally { await client.close(); }
})().catch(error => { console.error(error.message || String(error)); process.exitCode = 1; });
