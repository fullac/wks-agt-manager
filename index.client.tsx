// 注册子 Agent 来源分组和可撤销的工作区管理菜单。
import type { PluginClientContext } from '@getpaseo/plugin/client';
import { groupNativeMenu } from './client/web';
import { workspaceMenus } from './client/management';

export default function contribute(client: PluginClientContext) {
  const ungroup = groupNativeMenu();
  const removeMenus = workspaceMenus(client);
  return () => { removeMenus(); ungroup(); };
}
