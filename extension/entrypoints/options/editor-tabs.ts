type TabLabel = { id: string; label: string; key: string };
let sequence = 0;

/** Local editor navigation; the form and its drafts stay mounted when switching tabs. */
export function mountEditorTabs(root: HTMLElement, labels: TabLabel[], initial = labels[0]!.id): HTMLElement {
  const prefix = `editor-tabs-${++sequence}`;
  const bar = document.createElement('div');
  bar.className = 'editor-tabs';
  bar.setAttribute('role', 'tablist');
  const tabs = labels.map(({ id, label, key }) => {
    const tab = document.createElement('button');
    tab.type = 'button'; tab.id = `${prefix}-${id}-tab`; tab.dataset.editorTab = id;
    tab.textContent = label; tab.dataset.i18n = key; tab.setAttribute('role', 'tab');
    const panel = root.querySelector<HTMLElement>(`[data-editor-panel="${id}"]`)!;
    panel.id ||= `${prefix}-${id}-panel`;
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id);
    tab.setAttribute('aria-controls', panel.id);
    tab.addEventListener('click', () => activate(id));
    bar.append(tab);
    return tab;
  });
  function activate(id: string): void {
    root.dataset.activeEditorTab = id;
    for (const tab of tabs) {
      const selected = tab.dataset.editorTab === id;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      root.querySelector<HTMLElement>(`[data-editor-panel="${tab.dataset.editorTab}"]`)!.hidden = !selected;
    }
  }
  bar.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.indexOf(event.target as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[index]!.click(); tabs[index]!.focus();
  });
  root.addEventListener('settings-reveal', event => {
    const panel = (event.target as HTMLElement).closest<HTMLElement>('[data-editor-panel]');
    if (panel && root.contains(panel)) activate(panel.dataset.editorPanel!);
  });
  activate(initial);
  return bar;
}
