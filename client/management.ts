// 在工作区右键菜单加入项目选择和登记管理，所有改动先展示实际范围。
import type { PluginClientContext } from '@getpaseo/plugin/client';
import { attachRemovalHint, icon, menuCss, readMenuStyle } from './menu-appearance';
import { identity, management, type Query } from '../shared/management';

export function workspaceMenus(client: PluginClientContext) {
  if (typeof document === 'undefined') return () => {};
  const prefix = 'sidebar-workspace-menu-labels-';
  const mounted = new Map<Element, HTMLElement[]>();
  let host = '', stopped = false;
  let dialog: HTMLDialogElement | null = null;
  function dismissDialog() {
    if (dialog) { dialog.close(); dialog.remove(); dialog = null; }
  }
  const css = document.createElement('style'); css.textContent = menuCss; document.head.append(css);
  const button = (name: string, click: () => void) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = name; b.onclick = click;
    return b;
  };
  function rpc(wid: string, q: Omit<Query, 'workspace'|'host'>) {
    return client.rpc(management, {workspace: wid, host, ...q});
  }
  type Preview = {kind: 'move'|'release'|'remove'; target: string; title: string};
  function open(wid: string, paint: ReturnType<typeof readMenuStyle>, operation: Preview) {
    dismissDialog();
    const d = document.createElement('dialog');
    d.className = 'wm-dialog';
    paint(d);
    const {kind, target} = operation;
    const removing = kind !== 'move';
    const title = document.createElement('h2');
    title.textContent = removing ? operation.title : '移动到项目';
    title.id = 'wm-dialog-title';
    d.setAttribute('aria-labelledby', title.id);
    const header = document.createElement('header');
    const close = button('', () => d.close());
    close.setAttribute('aria-label', '关闭');
    close.append(icon('close'));
    header.append(title, close);

    const body = document.createElement('section');
    const footer = document.createElement('footer');
    const cancel = button('取消', () => d.close());
    const confirm = button(removing ? '确认移除并加入队列' : '确认移动并加入队列', () => {});
    confirm.className = 'wm-primary';
    confirm.disabled = true;
    footer.append(cancel, confirm);
    d.append(header, body, footer);
    document.body.append(d);
    dialog = d;
    const reveal = () => { if (d.isConnected && !d.open) { d.showModal(); cancel.focus(); } };
    const delay = window.setTimeout(reveal, 180);
    d.onclose = () => { clearTimeout(delay); d.remove(); if (dialog === d) dialog = null; };
    function line(text: string, className: string) {
      const p = document.createElement('p');
      p.textContent = text; p.className = className;
      return p;
    }
    function status(text: string, loading = false) {
      const item = line(text, loading ? 'wm-status wm-loading' : 'wm-status');
      item.setAttribute('role', 'status');
      body.replaceChildren(item);
    }
    function disclosure(label: string, list: HTMLElement) {
      const detail = document.createElement('details');
      const summary = document.createElement('summary');
      summary.append(icon('next'), label);
      detail.append(summary, list);
      return detail;
    }
    function failed(error: unknown) {
      status(error instanceof Error ? error.message : String(error));
      footer.replaceChildren(button('关闭', () => d.close()));
    }
    status('正在核对影响范围…', true);
    void rpc(wid, {op:'preview', action:kind, target}).then(p => {
      if (dialog !== d || !d.isConnected) return;
      const released = p.released ?? [];
      const files = p.files ?? [];
      const agent = released.find(a => a.id === target);
      const subject = kind === 'move' ? operation.title : agent?.title ?? p.workspace ?? target;
      const caption = kind === 'release' ? agent?.provider : undefined;
      const subjectRow = document.createElement('div');
      subjectRow.className = 'wm-subject';
      subjectRow.append(icon(kind === 'release' ? 'agent' : 'folder'), line(subject, 'wm-name'));
      if (caption) subjectRow.append(line(caption, 'wm-provider'));
      const impact = kind === 'remove' ? '从 Paseo 移除此工作区，保留工作树、项目文件和原生会话。'
        : kind === 'release' ? '解除此 Agent 的 Paseo 登记，保留原生会话，可重新导入。'
        : '工作区将归入目标项目，目录和 Agent 保持原样。';
      body.replaceChildren(subjectRow, line(impact, 'wm-impact'));
      // 父级引用等额外改动在确认前可见，通用的保留说明已由上方的操作文案呈现。
      for (const note of p.details ?? []) {
        if (note.startsWith('保留工作树、项目文件及原生会话；') || note.startsWith('只改该工作区的 projectId，')) continue;
        body.append(line(note, 'wm-impact'));
      }
      const group = document.createElement('div');
      group.className = 'wm-details';
      if (kind === 'remove' && released.length) {
        const list = document.createElement('ul');
        for (const a of released) {
          const row = document.createElement('li');
          row.append(line(a.title, 'wm-agent-name'), line(a.provider, 'wm-provider'));
          list.append(row);
        }
        group.append(disclosure('将释放的 Agent（' + released.length + '）', list));
      }
      const paths = document.createElement('pre');
      paths.textContent = files.join('\n');
      group.append(disclosure('涉及的登记文件（' + files.length + '）', paths));
      body.append(group, line('Paseo 后台下次停止时备份并执行。', 'wm-timing'));
      confirm.disabled = false;
      confirm.onclick = async () => {
        if (confirm.disabled) return;
        confirm.disabled = true;
        try {
          const result = await rpc(wid, {op:'submit', action:kind, target, token:p.token!});
          title.textContent = '已加入队列';
          status('Paseo 后台下次停止时执行。可在插件设置中查看记录。');
          const undo = button('取消排队', async () => {
            undo.disabled = true;
            try {
              await rpc(wid, {op:'cancel', target:result.id});
              title.textContent = '已取消排队'; status('登记未更改。'); undo.remove();
            } catch (e) { failed(e); }
          });
          footer.replaceChildren(undo, button('完成', () => d.close()));
        } catch (e) { failed(e); }
      };
    }).catch(failed).finally(() => { clearTimeout(delay); if (dialog === d) reveal(); });
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
        const b = button('', () => { close(); open(wid,paint,{kind:'move', target:p.id, title:c.workspace + ' → ' + p.name}); });
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
  function insertRow(anchor: HTMLElement, before: HTMLElement, row: HTMLButtonElement) {
    readMenuStyle(anchor)(row);
    row.className = 'wm-row';
    row.setAttribute('role', 'menuitem');
    row.dataset.menuItem = 'true';
    row.dataset.menuDisabled = 'false';
    row.tabIndex = anchor.tabIndex;
    row.addEventListener('click', e => e.stopPropagation());
    before.before(row);
  }

  const tabPrefix = 'workspace-tab-agent_';
  let invokedAgent: string | undefined;
  function rememberTab(event: Event) {
    const tab = event.target instanceof Element && event.target.closest<HTMLElement>('[data-testid^="workspace-tab-agent_"]');
    invokedAgent = tab ? tab.dataset.testid!.slice(tabPrefix.length) : undefined;
  }
  document.addEventListener('contextmenu', rememberTab, true);

  function addRemovals() {
    const selector = '[data-testid^="sidebar-workspace-menu-archive-"],' +
      '[data-testid^="workspace-tab-context-"][data-testid$="-close"],' +
      '[data-testid^="workspace-tab-menu-"][data-testid$="-close"]';
    for (const anchor of document.querySelectorAll<HTMLElement>(selector)) {
      if (mounted.has(anchor)) continue;
      const id = anchor.dataset.testid!;
      const archive = 'sidebar-workspace-menu-archive-';
      let wid: string, operation: Preview;
      if (id.startsWith(archive)) {
        if (!id.startsWith(archive + host + ':')) continue;
        wid = id.slice((archive + host + ':').length);
        operation = {kind: 'remove', target: '', title: '移除工作区'};
      } else {
        const route = (location.pathname + location.hash).match(/\/h\/([^/]+)\/workspace\/(wks_[\w-]+)(?:[/?#]|$)/);
        if (!route || route[1] !== host) continue;
        wid = route[2];
        const base = id.slice(0, -'-close'.length);
        const surface = anchor.closest('[data-menu-surface], [role="menu"], [role="dialog"]') || anchor.parentElement;
        const copy = surface?.querySelector('[data-testid="' + CSS.escape(base + '-copy-agent-id') + '"]');
        if (!copy) continue;
        const tabId = base.replace(/^workspace-tab-(context|menu)-/, '');
        const target = tabId.startsWith('agent_') ? tabId.slice('agent_'.length) : invokedAgent;
        // 已打开的草稿可能沿用旧标签 ID，以右键命中的 Agent 和菜单显示的短 ID 交叉核对。
        if (!target || !Array.from(copy.querySelectorAll('*')).some(el =>
          !el.childElementCount && el.textContent?.trim() === target.slice(0, 7))) continue;
        operation = {kind: 'release', target, title: '移除 Agent'};
      }
      if (!/^wks_[\w-]+$/.test(wid)) continue;
      const paint = readMenuStyle(anchor);
      const row = button('', () => { flyout?.close(); open(wid, paint, operation); });
      row.append(icon('remove'), operation.title);
      insertRow(anchor, anchor, row);
      if (operation.kind === 'release') {
        attachRemovalHint(row);
      }
      mounted.set(anchor, [row]);
    }
  }
  function render() {
    if (stopped || !host) return;
    for (const [key, rows] of mounted) if (!key.isConnected) {
      if (flyout && rows.includes(flyout.anchor)) flyout.close();
      rows.forEach(b => b.remove()); mounted.delete(key);
    }
    addRemovals();
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
      insertRow(labels, branch, move);
      mounted.set(labels, [move]);
    }
  }
  const observer = new MutationObserver(render);
  observer.observe(document.body, {childList:true, subtree:true});
  void client.rpc(identity, {}).then(id => { host = id; render(); }).catch(console.error);
  return () => { stopped = true; observer.disconnect(); document.removeEventListener('contextmenu', rememberTab, true); flyout?.close(); stay(); dismissDialog(); css.remove(); for (const rows of mounted.values()) rows.forEach(b => b.remove()); mounted.clear(); };
}
