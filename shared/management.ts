// 定义工作区菜单与本机登记管理进程之间的消息格式。
import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';

export const management = defineRpc({
  name: 'registry-management',
  input: z.object({
    op: z.enum(['catalog', 'preview', 'submit', 'cancel', 'history', 'import']),
    host: z.string().min(1), workspace: z.string().regex(/^wks_[a-zA-Z0-9_-]+$/).optional(),
    action: z.enum(['move', 'remove', 'release']).optional(),
    target: z.string().max(160).optional(), token: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).strict().refine(q => q.op === 'history' || Boolean(q.workspace), '请选择工作区'),
  output: z.object({
    workspace: z.string().optional(), project: z.string().optional(),
    destinations: z.array(z.object({id: z.string(), name: z.string()})).optional(),
    projects: z.array(z.object({id: z.string(), name: z.string()})).optional(),
    agents: z.array(z.object({id: z.string(), name: z.string(), provider: z.string()})).optional(),
    released: z.array(z.object({id: z.string(), title: z.string(), provider: z.string(), session: z.string()})).optional(),
    jobs: z.array(z.object({directory: z.string(), action: z.string().optional(), id: z.string(), state: z.string(), name: z.string().optional(), error: z.string().optional(), workspace: z.string().optional()})).optional(),
    details: z.array(z.string()).optional(), files: z.array(z.string()).optional(),
    token: z.string().optional(), id: z.string().optional(), ok: z.boolean().optional(),
  }),
});
export type Query = z.input<typeof management.input>;

export const identity = defineRpc({
  name: 'registry-host', input: z.object({}), output: z.string().min(1),
});
