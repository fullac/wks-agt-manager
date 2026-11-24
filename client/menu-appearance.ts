// 从当前 Paseo 菜单读取主题、行高和排版，供扩展菜单与确认窗口共用。
const paths = {
  folder: ['M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  remove: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'],
  move: ['M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v2','M3 7v12a2 2 0 0 0 2 2h5','M12 16h9m-4-4 4 4-4 4'],
  manage: ['M4 6h8m4 0h4M4 12h2m4 0h10M4 18h10m4 0h2','M12 3v6M7 9v6m8 0v6'],
  check: ['m4 12 5 5L20 6'], next: ['m9 5 7 7-7 7'], close: ['m6 6 12 12M18 6 6 18'],
};
export function icon(name: keyof typeof paths) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true');
  for (const d of paths[name]) {
    const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}
export function readMenuStyle(labels: HTMLElement) {
  const sample = getComputedStyle(labels.querySelector('[dir=auto]') || labels);
  const row = getComputedStyle(labels);
  let surface = labels.parentElement!;
  while (surface.parentElement && ['transparent','rgba(0, 0, 0, 0)'].includes(getComputedStyle(surface).backgroundColor))
    surface = surface.parentElement;
  const panel = getComputedStyle(surface);
  const theme: Record<string,string> = {
    '--wm-fg':sample.color, '--wm-bg':panel.backgroundColor, '--wm-muted':labels.querySelector('svg')?.getAttribute('stroke') || sample.color,
    '--wm-font':sample.fontFamily, '--wm-size':sample.fontSize, '--wm-weight':sample.fontWeight,
    '--wm-line':sample.lineHeight, '--wm-border':parseFloat(panel.borderWidth) ? panel.borderColor : 'color-mix(in srgb,var(--wm-fg) 15%, transparent)',
    '--wm-radius':parseFloat(panel.borderRadius) ? panel.borderRadius : '10px',
    '--wm-row-radius':row.borderRadius, '--wm-height':labels.offsetHeight + 'px',
    '--wm-inset':row.marginLeft, '--wm-row-border':row.borderLeftWidth, '--wm-padding':row.paddingLeft, '--wm-gap':row.columnGap === 'normal' ? '8px' : row.columnGap,
  };
  return (el: HTMLElement) => { for (const [key,value] of Object.entries(theme)) el.style.setProperty(key,value); };
}
export function attachRemovalHint(row: HTMLButtonElement) {
  const text = '从 Paseo 移除此 Agent 的登记，保留原生会话，之后可重新导入。';
  row.setAttribute('aria-label', '移除 Agent');
  row.setAttribute('aria-description', text);
  const tip = document.createElement('span');
  tip.className = 'wm-hint';
  tip.setAttribute('role', 'tooltip');
  tip.popover = 'manual';
  tip.textContent = text;
  row.append(tip);
  let timer = 0;
  function hide() {
    clearTimeout(timer);
    if (tip.matches(':popover-open')) tip.hidePopover();
  }
  function show() {
    hide();
    timer = window.setTimeout(() => {
      if (!row.isConnected) return;
      tip.showPopover();
      const anchor = row.getBoundingClientRect(), box = tip.getBoundingClientRect();
      const left = anchor.right + 8 + box.width <= innerWidth ? anchor.right + 8 : anchor.left - box.width - 8;
      tip.style.left = Math.max(4, left) + 'px';
      tip.style.top = Math.max(4, Math.min(anchor.top, innerHeight - box.height - 4)) + 'px';
    }, 250);
  }
  row.onpointerenter = e => { if (e.pointerType !== 'touch') show(); };
  row.onfocus = show;
  row.onpointerleave = row.onblur = hide;
  row.addEventListener('click', hide);
}
export const menuCss = `
.wm-row,.wm-panel,.wm-dialog {box-sizing:border-box;color:var(--wm-fg);font:var(--wm-weight) var(--wm-size)/var(--wm-line) var(--wm-font);}
.wm-row,.wm-panel button,.wm-dialog button {appearance:none;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left;}
.wm-row,.wm-option {display:flex;align-items:center;gap:var(--wm-gap);padding:0 var(--wm-padding);width:100%;min-height:var(--wm-height);border-radius:var(--wm-row-radius);}
button.wm-row {width:calc(100% - 2 * var(--wm-inset));margin-inline:var(--wm-inset);border:var(--wm-row-border) solid transparent;color:var(--wm-fg);font:var(--wm-weight) var(--wm-size)/var(--wm-line) var(--wm-font);}
.wm-row svg,.wm-panel svg,.wm-dialog svg {width:16px;height:16px;flex:none;stroke:var(--wm-muted);stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round;fill:none;}
.wm-row .wm-end,.wm-option .wm-end {margin-left:auto;width:14px;}
.wm-row:hover,.wm-row:focus-visible,.wm-row[aria-expanded=true],.wm-option:not(:disabled):hover,.wm-option:focus-visible,.wm-dialog button:hover,.wm-dialog button:focus-visible {background:color-mix(in srgb,var(--wm-fg) 10%,transparent);outline:none;}
.wm-panel,.wm-dialog {background-color:var(--wm-bg);border:1px solid var(--wm-border);border-radius:var(--wm-radius);box-shadow:0 6px 24px #0003;}
.wm-hint {position:fixed;inset:auto;margin:0;pointer-events:none;white-space:normal;max-width:min(250px,calc(100vw - 20px));padding:5px 8px;background:var(--wm-bg);color:var(--wm-fg);font:inherit;border:1px solid var(--wm-border);border-radius:6px;box-shadow:0 3px 12px #0002;}
.wm-panel {position:fixed;inset:auto;margin:0;padding:4px;min-width:min(190px,calc(100vw - 16px));max-width:min(340px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;z-index:2147483647;}
.wm-option span {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wm-option:disabled {cursor:default;}
.wm-dialog {padding:14px;width:min(420px,calc(100vw - 24px));max-height:80vh;overflow:auto;}
.wm-dialog::backdrop {background:rgba(0,0,0,.3);}
.wm-dialog header {display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 0 10px;border-bottom:1px solid var(--wm-border);}
.wm-dialog section {display:grid;gap:4px;padding-top:10px;overflow-wrap:anywhere;}
.wm-dialog section button {padding:6px 8px;border-radius:5px;}
.wm-dialog header button {display:grid;place-items:center;width:26px;height:26px;border-radius:5px;}
.wm-dialog pre {white-space:pre-wrap;overflow-wrap:anywhere;}
`;
