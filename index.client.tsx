// 注册子 Agent 来源分组和可撤销的工作区管理菜单。
import type { PluginClientContext } from '@getpaseo/plugin/client';
import { groupNativeMenu } from './client/web';
import { workspaceMenus } from './client/management';

import { HistorySettings } from './client/history-settings';

export default function contribute(client: PluginClientContext) {
  const removeSettings = client.addSettingsScreen({
    id: 'history', title: '操作记录与重新导入', icon: {svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'}, Component: HistorySettings,
  });
  const ungroup = groupNativeMenu();
  const removeMenus = workspaceMenus(client);
  return () => { removeMenus(); ungroup(); removeSettings(); };
}
