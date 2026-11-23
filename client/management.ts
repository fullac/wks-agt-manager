// 在工作区右键菜单加入项目选择和登记管理，所有改动先展示实际范围。
import type { PluginClientContext } from '@getpaseo/plugin/client';
import { icon, menuCss, readMenuStyle } from './menu-appearance';
import { identity, management, type Query } from '../shared/management';

export function workspaceMenus(client: PluginClientContext) {
  if (typeof document === 'undefined') return () => {};
  const prefix = 'sidebar-workspace-menu-labels-';
  const mounted = new Map<Element, HTMLElement[]>();
  let host = '', stopped = false;
  let dialog: HTMLDialogElement | null = null;
  const css = document.createElement('style'); css.textContent = menuCss; document.head.append(css);
  const button = (name: string, click: () => void) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = name; b.onclick = click;
    return b;
  };
  function rpc(wid: string, q: Omit<Query, 'workspace'|'host'>) {
    return client.rpc(management, {workspace: wid, host, ...q});
  }
  type Destination = {id: string; name: string; workspace: string};
  function open(wid: string, paint: ReturnType<typeof readMenuStyle>, destination?: Destination) {
    dialog?.close();
    const d = document.createElement('dialog'); d.className = 'wm-dialog'; paint(d);
    const title = document.createElement('strong');
    title.textContent = destination ? '移动到项目' : 'Workspace & Agent Manager';
    const header = document.createElement('header');
    const close = button('', () => d.close()); close.setAttribute('aria-label','关闭');
    close.append(icon('close')); header.append(title, close);
    const content = document.createElement('section');
    d.append(header, content); d.setAttribute('aria-label', title.textContent);
    d.onclose = () => { d.remove(); if (dialog === d) dialog = null; };
    document.body.append(d); dialog = d; d.showModal();
    const request = (q: Omit<Query, 'workspace'|'host'>) => rpc(wid, q);
    function action(label: string, fn: () => Promise<void>) {
      return button(label, () => { content.textContent = '正在读取…'; void fn().catch(error => {
        content.textContent = error instanceof Error ? error.message : String(error);
      }); });
    }
    async function preview(kind: 'move'|'release'|'remove', target: string, label: string) {
      const args = {action: kind, target};
      const p = await request({op: 'preview', ...args});
      title.textContent = label;
      const summary = document.createElement('div');
      summary.textContent = (p.details || []).join(' ');
      const files = document.createElement('details');
      const f = document.createElement('summary'); f.textContent = '查看 ' + p.files!.length + ' 个登记文件';
      const names = document.createElement('pre'); names.style.whiteSpace = 'pre-wrap';
      names.style.overflowWrap = 'anywhere'; names.textContent = p.files!.join('\n');
      files.append(f, names);
      content.replaceChildren(summary);
      for (const a of p.released || []) {
        const row = document.createElement('div'); row.textContent = a.provider + ' · ' + a.title; content.append(row);
      }
      const timing = document.createElement('p');
      timing.textContent = '确认后排队，Paseo 后台下次停止时执行。原始登记会备份，可在操作记录查看结果。';
      content.append(files, timing, action('确认并加入队列', async () => {
        const result = await request({op: 'submit', ...args, token: p.token!});
        content.textContent = '已排队，等待 Paseo 后台停止。';
        content.append(action('取消排队', async () => {
          await request({op: 'cancel', target: result.id}); content.textContent = '已取消';
        }));
      }));
    }
    async function history() {
      const h = await request({op: 'history'});
      title.textContent = '操作记录与重新导入'; content.replaceChildren();
      for (const j of h.jobs || []) {
        const row = document.createElement('div');
        const states: Record<string,string> = {queued:'等待后台停止', applying:'执行中', done:'已完成', error:'失败', cancelled:'已取消'};
        row.textContent = [j.name, states[j.state], j.error].filter(Boolean).join(' · ');
        const detail = document.createElement('details');
        const heading = document.createElement('summary'); heading.textContent = '本机操作记录';
        detail.append(heading, document.createTextNode('~/.paseo/plugin-data/subagent-groups/management/' + j.id + '/'));
        row.append(detail);
        if (j.state === 'queued' && j.workspace === wid) row.append(action('取消', async () => {
          await request({op:'cancel',target:j.id}); await history();
        }));
        content.append(row);
      }
      for (const a of h.released || []) content.append(action('导入到此工作区 · ' + a.title, async () => {
        title.textContent = '导入到此工作区'; content.textContent = a.provider + ' · ' + a.title;
        content.append(action('确认导入', async () => {
          const result = await request({op:'import', target:a.id});
          content.textContent = '已导入 · ' + result.id;
        }));
      }));
      if (!content.childElementCount) content.textContent = '暂无操作记录';
    }
    if (destination) {
      void preview('move', destination.id, '移动「' + destination.workspace + '」到「' + destination.name + '」')
        .catch(e => { content.textContent = String(e); });
      return;
    }
    void request({op:'catalog'}).then(c => {
        content.append(action('移除此工作区并释放 Agent', () => preview('remove', '', '移除「' + c.workspace + '」')));
        for (const a of c.agents || []) content.append(action('移除 Agent · ' + a.name,
          () => preview('release', a.id, '释放「' + a.name + '」')));
        content.append(action('操作记录与重新导入', history));
    }).catch(e => { content.textContent = String(e); });
  }
  let flyout: {panel: HTMLElement; anchor: HTMLElement; close: () => void} | null = null;
  let leaveTimer = 0;
  function stay() { clearTimeout(leaveTimer); }
  function leave() { stay(); leaveTimer = window.setTimeout(() => flyout?.close(), 180); }
  function projects(wid: string, anchor: HTMLElement, paint: ReturnType<typeof readMenuStyle>, focus: boolean) {
    stay();
    if (flyout?.anchor === anchor) {
      if (focus) flyout.panel.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
      return;
    }
    flyout?.close();
    const panel = document.createElement('div');
    panel.className = 'wm-panel'; paint(panel);
    panel.setAttribute('role','menu'); panel.setAttribute('aria-label','移动到项目');
    panel.popover = 'manual'; panel.textContent = '正在读取…';
    document.body.append(panel); panel.showPopover();
    anchor.setAttribute('aria-expanded','true');
    function place() {
      const a = anchor.getBoundingClientRect(), box = panel.getBoundingClientRect();
      const right = a.right - 1, left = a.left - box.width + 1;
      const x = right + box.width <= innerWidth - 6 ? right : Math.max(6, Math.min(left, innerWidth - box.width - 6));
      panel.style.left = x + 'px'; panel.style.top = Math.max(6, Math.min(a.top, innerHeight - box.height - 6)) + 'px';
    }
    function outside(e: Event) {
      if (e.target instanceof Node && !panel.contains(e.target) && !anchor.contains(e.target)) close();
    }
    function keys(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'ArrowLeft') {
        e.preventDefault(); e.stopImmediatePropagation(); close(); anchor.focus(); return;
      }
      if (!panel.contains(document.activeElement)) return;
      const options = Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = options.indexOf(document.activeElement as HTMLButtonElement);
      if (options.length && ['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
        e.preventDefault(); e.stopImmediatePropagation();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (index + (e.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
        options[next].focus();
      }
    }
    function close() {
      stay(); anchor.setAttribute('aria-expanded','false'); panel.remove();
      window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', keys, true);
      window.removeEventListener('resize', place); if (flyout?.panel === panel) flyout = null;
    }
    flyout = {anchor, panel, close};
    panel.onpointerenter = stay; panel.onpointerleave = leave;
    window.addEventListener('pointerdown',outside,true); window.addEventListener('keydown',keys,true); window.addEventListener('resize',place);
    place();
    void rpc(wid,{op:'catalog'}).then(c => {
      if (!panel.isConnected) return;
      panel.replaceChildren();
      for (const p of c.projects || []) {
        const current = p.id === c.project;
        const b = button('', () => { close(); open(wid,paint,{...p, workspace:c.workspace!}); });
        b.className = 'wm-option'; b.disabled = current; b.title = p.name;
        b.setAttribute('role','menuitemradio'); b.setAttribute('aria-checked',String(current));
        const label = document.createElement('span'); label.textContent = p.name;
        b.append(icon('folder'),label);
        if (current) { const check = icon('check'); check.classList.add('wm-end'); b.append(check); }
        panel.append(b);
      }
      place(); if (focus) panel.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    }).catch(e => { panel.textContent = String(e); place(); });
  }
  function render() {
    if (stopped || !host) return;
    for (const [key, rows] of mounted) if (!key.isConnected) {
      if (flyout && rows.includes(flyout.anchor)) flyout.close();
      rows.forEach(b => b.remove()); mounted.delete(key);
    }
    for (const labels of document.querySelectorAll<HTMLElement>('[data-testid^="' + prefix + '"]')) {
      if (mounted.has(labels)) continue;
      const key = labels.dataset.testid!.slice(prefix.length);
      if (!key.startsWith(host + ':')) continue;
      const wid = key.slice(host.length + 1);
      if (!/^wks_[\w-]+$/.test(wid)) continue;
      // 标签的外层也监听 pointerenter，必须在它与普通菜单行的共同父级插入。
      const surface = labels.closest('[data-menu-surface], [role="menu"]') || labels.closest('[role="dialog"]');
      const peer = surface?.querySelector('[data-testid="' + CSS.escape('sidebar-workspace-menu-pin-' + key) + '"]')
        || document.querySelector('[data-testid="' + CSS.escape('sidebar-workspace-menu-copy-path-' + key) + '"]');
      if (!peer) continue;
      let branch = labels;
      while (branch.parentElement && !branch.parentElement.contains(peer)) branch = branch.parentElement;
      if (!branch.parentElement || branch.contains(peer)) continue;
      const paint = readMenuStyle(labels);
      const move = button('', () => projects(wid,move,paint,true));
      move.append(icon('move'),'移动到项目'); const arrow = icon('next'); arrow.classList.add('wm-end'); move.append(arrow);
      move.setAttribute('aria-haspopup','menu'); move.setAttribute('aria-expanded','false');
      move.onpointerenter = e => { if (e.pointerType !== 'touch') projects(wid,move,paint,false); };
      move.onpointerleave = leave;
      move.onkeydown = e => { if (e.key === 'ArrowRight') { e.preventDefault(); projects(wid,move,paint,true); } };
      const manage = button('', () => { flyout?.close(); open(wid,paint); });
      manage.append(icon('manage'),'Workspace & Agent Manager'); manage.onpointerenter = () => flyout?.close();
      const rows = [move, manage];
      for (const b of rows) {
        paint(b); b.className = 'wm-row'; b.setAttribute('role','menuitem');
        b.dataset.menuItem = 'true'; b.dataset.menuDisabled = 'false'; b.tabIndex = labels.tabIndex;
        b.addEventListener('click',e => e.stopPropagation()); branch.before(b);
      }
      mounted.set(labels, rows);
    }
  }
  const observer = new MutationObserver(render);
  observer.observe(document.body, {childList:true, subtree:true});
  void client.rpc(identity, {}).then(id => { host = id; render(); }).catch(console.error);
  return () => { stopped = true; observer.disconnect(); flyout?.close(); stay(); dialog?.close(); css.remove(); for (const rows of mounted.values()) rows.forEach(b => b.remove()); mounted.clear(); };
}
