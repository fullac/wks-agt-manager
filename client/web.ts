// 在桌面版原生子 Agent 菜单内增加分类切换，保留原有行、事件和操作。
type Element = any;
type Browser = { document?: any; MutationObserver?: any; requestAnimationFrame?: any; cancelAnimationFrame?: any; __paseoSubagentGroups?: { users: number; stop: () => void } };
const browser = globalThis as unknown as Browser;

export function groupNativeMenu() {
  if (!browser.document || !browser.MutationObserver) return () => {};
  if (browser.__paseoSubagentGroups) {
    browser.__paseoSubagentGroups.users++;
    return release;
  }
  const document = browser.document;
  const menus = new Map<Element, { header: Element; selected: string; buttons: Element[] }>();
  const originals = new Map<Element, string>();
  let scheduled = 0;
  let stopped = false;
  function display(element: Element, visible: boolean) {
    if (!originals.has(element)) originals.set(element, element.style.display);
    const next = visible ? originals.get(element)! : 'none';
    if (element.style.display !== next) element.style.display = next;
  }
  function restore(element: Element) {
    if (element?.isConnected && originals.has(element)) element.style.display = originals.get(element);
    originals.delete(element);
  }
  function render() {
    scheduled = 0;
    if (stopped) return;
    for (const element of originals.keys()) if (!element.isConnected) originals.delete(element);
    for (const [container, state] of menus) {
      if (!container.isConnected) { state.header.remove(); menus.delete(container); }
    }
    // facts 是行内的副标题，不是独立任务。
    const rows = Array.from(document.querySelectorAll('[data-testid^="subagents-track-row-"]'))
      .filter((row: any) => !row.getAttribute('data-testid').startsWith('subagents-track-row-facts-')) as Element[];
    const groups = new Map<Element, Element[]>();
    for (const row of rows) {
      const wrapper = row.parentElement;
      const container = wrapper?.parentElement;
      if (!container) continue;
      const list = groups.get(container) || [];
      list.push(row); groups.set(container, list);
    }
    for (const [container, state] of menus) {
      if (groups.has(container)) continue;
      state.header.remove(); menus.delete(container);
      for (const element of originals.keys()) if (container.contains(element)) restore(element);
    }
    for (const [container, list] of groups) {
      let state = menus.get(container);
      if (!state) {
        const header = document.createElement('div');
        header.setAttribute('data-subagent-groups', 'switcher');
        header.setAttribute('role', 'group');
        header.setAttribute('aria-label', '子 Agent 来源');
        Object.assign(header.style, { display: 'flex', flexDirection: 'row', gap: '4px', padding: '4px 4px 8px', flexShrink: '0' });
        state = { header, selected: '', buttons: [] };
        for (const kind of ['paseo', 'native']) {
          const button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('role', 'menuitemradio');
          button.setAttribute('data-menu-item', 'true');
          button.setAttribute('data-menu-disabled', 'false');
          button.tabIndex = -1;
          Object.assign(button.style, { flex: '1', font: 'inherit', fontSize: '13px', lineHeight: '20px', cursor: 'pointer', padding: '5px 10px', border: '0', borderRadius: '6px', textAlign: 'center', whiteSpace: 'nowrap' });
          button.addEventListener('click', (event: any) => {
            event.preventDefault(); event.stopPropagation();
            state!.selected = kind; render();
          });
          header.appendChild(button); state.buttons.push(button);
        }
        menus.set(container, state);
      }
      if (state.header.parentElement !== container) container.insertBefore(state.header, container.firstChild);
      // Paseo 只给其托管的 Agent 渲染归档控件，宿主原生任务没有该控件。
      const classified = list.map((row) => ({ row, kind: row.querySelector('[data-testid^="subagents-track-archive-"]') ? 'paseo' : 'native' }));
      const managedCount = classified.filter(({ kind }) => kind === 'paseo').length;
      const nativeCount = list.length - managedCount;
      if (!state.selected) state.selected = managedCount ? 'paseo' : 'native';
      const sample = list[0].firstElementChild || list[0];
      const view = document.defaultView;
      const title = list[0].querySelector('[dir="auto"]') || sample;
      const rowStyle = view.getComputedStyle(title);
      const labelStyle = view.getComputedStyle(list[0].querySelector('[data-testid^="subagents-track-row-facts-"]') || sample);
      state.header.style.fontFamily = rowStyle.fontFamily;
      state.buttons.forEach((button, index) => {
        const kind = index ? 'native' : 'paseo';
        const selected = state!.selected === kind;
        const text = `${index ? '原生' : 'Paseo'} · ${index ? nativeCount : managedCount}`;
        if (button.textContent !== text) button.textContent = text;
        button.setAttribute('aria-checked', String(selected));
        button.style.color = selected ? rowStyle.color : labelStyle.color;
        button.style.background = selected ? 'color-mix(in srgb, currentColor 9%, transparent)' : 'transparent';
        button.style.fontWeight = selected ? '600' : '400';
      });
      for (const { row, kind } of classified) display(row.parentElement, state.selected === kind);
      // 内置批量归档包含两类任务；分类后隐藏它，避免处理当前看不到的任务。
      const archive = container.querySelector('[data-testid="subagents-track-archive-finished"]');
      if (archive) {
        let wrapper = archive;
        while (wrapper.parentElement && wrapper.parentElement !== container) wrapper = wrapper.parentElement;
        if (wrapper.parentElement === container) display(wrapper, false);
      }
    }
  }
  const observer = new browser.MutationObserver((records: any[]) => {
    if (records.every((record) => record.target.closest?.('[data-subagent-groups]'))) return;
    if (!scheduled) scheduled = browser.requestAnimationFrame!(render);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  render();
  browser.__paseoSubagentGroups = { users: 1, stop: () => {
    stopped = true; observer.disconnect();
    if (scheduled) browser.cancelAnimationFrame!(scheduled);
    for (const state of menus.values()) state.header.remove();
    menus.clear();
    for (const element of originals.keys()) restore(element);
  } };
  return release;
}
function release() {
  const shared = browser.__paseoSubagentGroups;
  if (shared && --shared.users === 0) { shared.stop(); delete browser.__paseoSubagentGroups; }
}
