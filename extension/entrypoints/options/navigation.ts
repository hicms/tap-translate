const sectionIds = ['section-connection', 'section-reading', 'section-sites', 'section-data'];

function activate(id: string, updateHistory = false): void {
  if (!sectionIds.includes(id)) id = sectionIds[0]!;
  for (const sectionId of sectionIds) document.getElementById(sectionId)!.hidden = sectionId !== id;
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-section-nav]')) {
    const active = link.dataset.sectionNav === id;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (updateHistory && location.hash !== `#${id}`) history.pushState(null, '', `#${id}`);
}

export function revealSettingsElement(element: HTMLElement): void {
  const section = element.closest<HTMLElement>('section[id^="section-"]');
  if (section) activate(section.id, true);
  element.dispatchEvent(new Event('settings-reveal', { bubbles: true }));
  let parent = element.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  element.focus();
  element.scrollIntoView({ block: 'center' });
}

export function revealSettingsError(): void {
  const invalid = document.querySelector<HTMLElement>('#optionsForm :invalid, #optionsForm [aria-invalid="true"]:not([type="hidden"]), #optionsForm .is-invalid input:not([type="hidden"])');
  if (invalid) revealSettingsElement(invalid);
}

export function mountSettingsNavigation(): void {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-section-nav]')];
  const sync = () => activate(location.hash.slice(1));
  for (const link of links) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      activate(link.dataset.sectionNav!, true);
    });
    link.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = links.indexOf(link);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1
        : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + links.length) % links.length;
      links[next]!.click(); links[next]!.focus();
    });
  }
  window.addEventListener('popstate', sync);
  window.addEventListener('hashchange', sync);
  // Browser form validation runs before submit; reveal synchronously so it can focus.
  document.getElementById('optionsForm')!.addEventListener('invalid', (event) => {
    revealSettingsElement(event.target as HTMLElement);
  }, true);
  sync();
}
