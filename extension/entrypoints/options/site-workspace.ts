import { siteProfiles, resolveSiteProfile } from '../../lib/sites';

type Translate = (key: string, subs?: (string | number)[]) => string;

export function mountSiteWorkspace(t: Translate): {
  refresh(preferred?: HTMLElement): void;
  selectedHost(): string;
  activeTab(): string;
} {
  const workspace = document.getElementById('siteWorkspace')!;
  const cards = document.getElementById('siteRuleRows')!;
  const list = document.getElementById('siteList')!;
  const search = document.getElementById('siteSearch') as HTMLInputElement;
  let selected: HTMLElement | undefined;
  const hostOf = (card: HTMLElement) => card.querySelector<HTMLInputElement>('[data-field="host"]')!.value;
  const allCards = () => [...cards.querySelectorAll<HTMLElement>('.site-card')];

  function select(card: HTMLElement): void {
    selected = card;
    for (const entry of allCards()) entry.hidden = entry !== card;
    workspace.classList.add('is-editing');
    renderList();
  }

  function renderList(): void {
    const scrollTop = list.scrollTop;
    const query = search.value.trim().toLowerCase();
    const entries = allCards();
    const groups: { name: string; hosts: string[]; card: HTMLElement; builtin: boolean }[] = [];
    for (const profile of siteProfiles) {
      const aliases = entries.filter(card => profile.hosts.includes(hostOf(card)));
      if (aliases.length) groups.push({ name: profile.hosts[0]!, hosts: [...profile.hosts], card: aliases.includes(selected!) ? selected! : aliases[0]!, builtin: true });
    }
    for (const card of entries) if (!resolveSiteProfile(hostOf(card))) {
      groups.push({ name: hostOf(card) || t('workspaceNewSite'), hosts: [hostOf(card)], card, builtin: false });
    }
    list.replaceChildren();
    for (const builtin of [true, false]) {
      const group = groups.filter(item => item.builtin === builtin && item.hosts.join(' ').toLowerCase().includes(query));
      if (!group.length) continue;
      const heading = document.createElement('h3');
      heading.className = 'workspace-group'; heading.textContent = t(builtin ? 'contentBuiltinSites' : 'contentCustomSites');
      list.append(heading);
      for (const item of group) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'workspace-item'; button.dataset.siteHost = item.hosts[0];
        button.setAttribute('aria-pressed', String(item.card === selected));
        const name = document.createElement('strong'); name.textContent = item.name;
        const detail = document.createElement('small');
        detail.textContent = item.hosts.length > 1 ? t('workspaceHostCount', [item.hosts.length]) : t(builtin ? 'contentBuiltinSites' : 'contentCustomSites');
        button.append(name, detail);
        button.addEventListener('click', () => {
          select(item.card);
          if (matchMedia('(max-width: 700px)').matches) item.card.querySelector<HTMLElement>('.workspace-back')!.focus();
          else list.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
        });
        list.append(button);
      }
    }
    if (!list.children.length) {
      const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = t('workspaceNoMatches'); list.append(empty);
    }
    list.scrollTop = scrollTop;
  }

  function refresh(preferred?: HTMLElement): void {
    const entries = allCards();
    for (const card of entries) {
      if (card.dataset.workspaceReady) continue;
      card.dataset.workspaceReady = 'true';
      const back = document.createElement('button');
      back.type = 'button'; back.className = 'workspace-back btn-link'; back.textContent = t('workspaceBackSites'); back.dataset.i18n = 'workspaceBackSites';
      back.addEventListener('click', () => {
        workspace.classList.remove('is-editing');
        list.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
      });
      card.querySelector('.site-card-head')!.prepend(back);
      const profile = resolveSiteProfile(hostOf(card));
      if (profile) {
        const input = card.querySelector<HTMLInputElement>('[data-field="host"]')!;
        const select = document.createElement('select'); select.className = 'site-domain-select'; select.id = `${input.id}-domain`;
        for (const host of profile.hosts) select.add(new Option(host, host));
        select.value = input.value; input.type = 'hidden';
        card.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)!.htmlFor = select.id;
        input.after(select);
        select.addEventListener('change', () => {
          const next = allCards().find(entry => hostOf(entry) === select.value)!;
          // Each hostname keeps a separate draft, including its selected tab.
          const tab = card.dataset.activeEditorTab;
          if (tab) next.querySelector<HTMLButtonElement>(`[data-editor-tab="${tab}"]`)!.click();
          select.value = input.value;
          refresh(next);
          next.querySelector<HTMLSelectElement>('.site-domain-select')!.focus();
        });
      }
    }
    const next = preferred ?? (selected?.isConnected ? selected : entries[0]);
    if (next) select(next);
    else { selected = undefined; renderList(); }
  }

  search.addEventListener('input', renderList);
  cards.addEventListener('input', event => {
    if ((event.target as HTMLElement).matches('[data-field="host"]')) renderList();
  });
  cards.addEventListener('settings-reveal', event => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('.site-card');
    if (card) select(card);
  });
  return { refresh, selectedHost: () => selected ? hostOf(selected) : '', activeTab: () => selected?.dataset.activeEditorTab ?? 'preferences' };
}
