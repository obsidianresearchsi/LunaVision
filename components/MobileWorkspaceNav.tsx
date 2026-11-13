import React, { useEffect, useRef } from 'react';
import { ChevronRight, Ellipsis, X, type LucideIcon } from 'lucide-react';

type NavigationItem = { id: string; label: string; icon: LucideIcon };
type Props = {
  workspace: string;
  active: string;
  tabs: { id: string; label: string }[];
  groups: { label: string; items: NavigationItem[] }[];
  controls?: React.ReactNode;
  onNavigate: (page: string) => void;
};

export default function MobileWorkspaceNav({ workspace, active, tabs, groups, controls, onNavigate }: Props) {
  const sheet = useRef<HTMLDialogElement>(null);
  const entries = groups.flatMap(group => group.items);
  const quickTabs = tabs.flatMap(tab => {
    const item = entries.find(entry => entry.id === tab.id);
    return item ? [{ ...item, label: tab.label }] : [];
  });
  const moreActive = entries.some(item => item.id === active) && !quickTabs.some(tab => tab.id === active);

  useEffect(() => {
    const phoneLayout = window.matchMedia?.('(max-width: 760px)');
    function closeOnDesktop(event: MediaQueryListEvent) {
      if (!event.matches && sheet.current?.open) sheet.current.close();
    }
    phoneLayout?.addEventListener('change', closeOnDesktop);
    return () => phoneLayout?.removeEventListener('change', closeOnDesktop);
  }, []);

  return (
    <div className="lv-mobile-navigation">
      <nav className="lv-mobile-tabs" aria-label="Quick navigation">
        {quickTabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={active === id ? 'page' : undefined} onClick={() => onNavigate(id)}>
            <span className="lv-mobile-tab-icon"><Icon size={21} strokeWidth={1.8} aria-hidden="true" /></span>
            <span>{label}</span>
          </button>
        ))}
        <button type="button" data-active={moreActive} aria-haspopup="dialog" onClick={() => sheet.current?.showModal()}>
          <span className="lv-mobile-tab-icon"><Ellipsis size={22} aria-hidden="true" /></span>
          <span>More</span>
        </button>
      </nav>
      <dialog ref={sheet} className="lv-mobile-sheet" aria-label="Workspace menu"
        onClick={event => { if (event.target === event.currentTarget) sheet.current?.close(); }}>
        <div className="lv-mobile-sheet-inner">
          <header className="lv-mobile-sheet-header">
            <div><h2>Workspace menu</h2><p>{workspace}</p></div>
            <button type="button" aria-label="Close workspace menu" autoFocus onClick={() => sheet.current?.close()}>
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          <div className="lv-mobile-sheet-body">
            {groups.map(group => (
              <section key={group.label} className="lv-mobile-sheet-group">
                <h3>{group.label}</h3>
                {group.items.map(({ id, label, icon: Icon }) => (
                  <button key={id} type="button" aria-current={active === id ? 'page' : undefined}
                    onClick={() => { sheet.current?.close(); onNavigate(id); }}>
                    <Icon size={19} aria-hidden="true" /><span>{label}</span><ChevronRight size={16} aria-hidden="true" />
                  </button>
                ))}
              </section>
            ))}
            {controls && <div className="lv-mobile-sheet-controls" onChange={event => {
              if (event.target instanceof HTMLSelectElement) sheet.current?.close();
            }}>{controls}</div>}
          </div>
        </div>
      </dialog>
    </div>
  );
}
