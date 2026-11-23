// 将菜单请求限定在当前本机插件和后台目录，离线登记操作交给独立维护进程。
import type { PluginServerContext } from '@getpaseo/plugin/server';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { identity, management } from './shared/management';

export default function contribute(server: PluginServerContext) {
  const home = process.env.PASEO_HOME || join(homedir(), '.paseo');
  const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
  const source = config.plugins?.['subagent-groups']?.path;
  if (typeof source !== 'string') throw new Error('未找到本机 subagent-groups 插件目录');
  const worker = join(source, 'server', 'registry.py');
  function run(command: string, args: string[], input?: unknown): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'pipe' });
      let out = '', error = '';
      child.stdout.setEncoding('utf8').on('data', (s) => { out += s; });
      child.stderr.setEncoding('utf8').on('data', (s) => { error += s; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(out) : reject(new Error(error.trim() || '登记管理进程退出')));
      child.stdin.on('error', () => {});
      child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
    });
  }
  server.handle(identity, () => readFileSync(join(home, 'server-id'), 'utf8').trim());
  const resources = (process as NodeJS.Process & {resourcesPath?: string}).resourcesPath;
  const supported = resources && JSON.parse(readFileSync(
    join(resources, 'app.asar/node_modules/@getpaseo/server/package.json'), 'utf8',
  )).version === '0.17.3';
  if (supported) void run('python3', [worker, 'resume', home]).catch(console.error);
  server.handle(management, async query => {
    if (!supported) throw new Error('登记管理适用于 Paseo Desktop 0.17.3 的本机后台');
    const q = query.op === 'import' ? {...query, op: 'import-info'} : query;
    const result = JSON.parse(await run('python3', [worker, 'request', home], q));
    if (query.op !== 'import') return result;
    if (result.existing) return {id: result.existing};
    try {
      const response = await run(process.execPath, [join(source, 'server', 'import.cjs'), home], result);
      return {id: JSON.parse(response).id};
    } catch (error) {
      // 回复丢失时确认后台是否已完成同一导入，避免引导用户重复操作。
      const check = JSON.parse(await run('python3', [worker, 'request', home], q));
      if (check.existing) return {id: check.existing};
      throw error;
    }
  });
  return () => {};
}
