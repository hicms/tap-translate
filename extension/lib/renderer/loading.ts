import { collectVisibleTextNodes } from '../collector';
import { CLS_LOADING, CLS_LOADING_STYLE } from '../dom-const';
import { getLoadingMessage, type LoadingPhase } from '../i18n/loading';
import { walkOpenShadowRoots } from '../roots';
import type { TranslationUnit } from '../types';
import { loadingGroupHost, loadingGroupTail } from './loading-group';
import loadingStyles from './loading.css?raw';

type StyleRoot = Document | ShadowRoot;
interface Member {
  unit: TranslationUnit;
  group: Group;
  phase: LoadingPhase | 'ready';
  timer: ReturnType<typeof setTimeout> | null;
  eligible: boolean;
}
interface Group {
  host: HTMLElement;
  members: Set<Member>;
  anchor: Text | HTMLElement | null;
  node?: HTMLElement;
  root?: StyleRoot;
}

/** Session-owned feedback: many translation jobs, one indicator per prose region. */
export class LoadingIndicators {
  private readonly members = new Map<HTMLElement, Member>();
  private readonly groups = new Map<HTMLElement, Group>();
  private readonly styles = new Map<StyleRoot, { node: HTMLStyleElement; users: number }>();

  constructor(private readonly uiLocale: string) {}

  update(unit: TranslationUnit, phase: LoadingPhase): void {
    let member = this.members.get(unit.el);
    if (!member) {
      const host = loadingGroupHost(unit);
      let group = this.groups.get(host);
      if (!group) {
        group = { host, members: new Set(), anchor: loadingGroupTail(host) };
        this.groups.set(host, group);
      }
      const tail = (unit.nodes ?? collectVisibleTextNodes(unit.el)).at(-1);
      if (tail && (!group.anchor || (!group.anchor.contains(tail)
        && (group.anchor.compareDocumentPosition(tail) & Node.DOCUMENT_POSITION_FOLLOWING)))) {
        group.anchor = tail;
      }
      member = { unit, group, phase, timer: null, eligible: false };
      this.members.set(unit.el, member);
      group.members.add(member);
    }
    member.phase = phase;
    if (member.timer) clearTimeout(member.timer);
    member.timer = null;
    const current = member;
    // Each job keeps its own grace; a new sibling must not reset existing waits.
    member.timer = setTimeout(() => {
      current.timer = null;
      current.eligible = true;
      this.refresh(current.group);
    }, phase === 'queued' ? 450 : 150);
    if (member.group.node) this.refresh(member.group);
  }

  /** Keep membership through buffered paint, but never flash for a fast result. */
  ready(host: HTMLElement): void {
    const member = this.members.get(host);
    if (!member) return;
    if (member.timer) clearTimeout(member.timer);
    member.timer = null;
    member.phase = 'ready';
    member.eligible = false;
    if (member.group.node) this.refresh(member.group);
  }

  clear(host: HTMLElement): void {
    const group = this.removeMember(host);
    if (group) this.refresh(group);
    // Completed members can still own the tail anchor when the site removes them.
    for (const active of this.groups.values()) {
      if (!active.anchor?.isConnected || !active.host.contains(active.anchor)
        || (active.node && !active.node.isConnected)) this.refresh(active);
    }
  }

  clearAll(): void {
    for (const host of this.members.keys()) this.removeMember(host);
  }

  /** Protect shared feedback from replacement stashes and rich-text skeletons. */
  render<T>(units: readonly TranslationUnit[], paint: () => T): T {
    const affected = new Set<Group>();
    for (const unit of units) {
      const group = this.members.get(unit.el)?.group;
      if (!group) continue;
      if (group.anchor && unit.el.contains(group.anchor)) group.anchor = unit.el;
      group.node?.remove();
      affected.add(group);
    }
    try {
      return paint();
    } finally {
      for (const unit of units) this.removeMember(unit.el);
      for (const group of affected) this.refresh(group);
    }
  }

  private removeMember(host: HTMLElement): Group | undefined {
    const member = this.members.get(host);
    if (!member) return;
    if (member.timer) clearTimeout(member.timer);
    this.members.delete(host);
    const group = member.group;
    group.members.delete(member);
    if (!group.members.size) {
      group.node?.remove();
      if (group.root) {
        const style = this.styles.get(group.root)!;
        if (--style.users === 0) {
          style.node.remove();
          this.styles.delete(group.root);
        }
      }
      this.groups.delete(group.host);
    }
    return group;
  }

  private refresh(group: Group): void {
    if (!group.members.size) return;
    if (!group.host.isConnected) {
      for (const member of group.members) this.removeMember(member.unit.el);
      return;
    }
    if (!group.anchor?.isConnected || !group.host.contains(group.anchor)) {
      group.anchor = loadingGroupTail(group.host);
    }
    if (!group.anchor) return;
    if (!group.node) {
      if (![...group.members].some(member => member.eligible)) return;
      this.mount(group);
    }
    const node = group.node!;
    const phases = [...group.members].map(member => member.phase);
    const phase: LoadingPhase = phases.includes('translating') ? 'translating'
      : phases.includes('retrying') ? 'retrying'
        : phases.includes('queued') ? 'queued' : 'translating';
    const label = getLoadingMessage(phase, this.uiLocale);
    node.dataset.phase = phase;
    node.setAttribute('aria-label', label);
    node.title = label;
    const anchor = group.anchor;
    if (anchor instanceof HTMLElement) {
      if (anchor.lastChild !== node) anchor.appendChild(node);
    } else if (anchor.nextSibling !== node) {
      anchor.parentNode!.insertBefore(node, anchor.nextSibling);
    }
  }

  private mount(group: Group): void {
    const root = group.host.getRootNode() as StyleRoot;
    let style = this.styles.get(root);
    if (!style) {
      const node = group.host.ownerDocument.createElement('style');
      node.className = CLS_LOADING_STYLE;
      node.textContent = loadingStyles;
      (root instanceof Document ? root.head ?? root.documentElement : root).appendChild(node);
      style = { node, users: 0 };
      this.styles.set(root, style);
    }
    style.users++;
    group.root = root;
    const node = group.host.ownerDocument.createElement('span');
    node.className = CLS_LOADING;
    node.setAttribute('translate', 'no');
    node.setAttribute('role', 'img');
    node.lang = this.uiLocale;
    // No text nodes: source collection and rich skeletons cannot consume labels.
    group.node = node;
  }
}

/** Also handles orphaned markers after an extension context was replaced. */
export function clearLoadingDom(): void {
  for (const root of [document, ...walkOpenShadowRoots(document)]) {
    root.querySelectorAll(`.${CLS_LOADING}, .${CLS_LOADING_STYLE}`).forEach(node => node.remove());
  }
}
