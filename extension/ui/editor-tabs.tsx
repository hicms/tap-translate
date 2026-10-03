import { useId } from 'react';
import { Button } from '@astryxdesign/core/Button';

export function EditorTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const prefix = useId();
  return (
    <div
      className="editor-tabs"
      role="tablist"
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const focused =
          (event.target as HTMLElement).closest<HTMLElement>('[data-editor-tab]')?.dataset.editorTab ?? value;
        const index = tabs.findIndex((tab) => tab.id === focused);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        onChange(tabs[next]!.id);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}
    >
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          id={`${prefix}-${tab.id}`}
          variant="ghost"
          label={tab.label}
          role="tab"
          data-editor-tab={tab.id}
          aria-selected={value === tab.id}
          tabIndex={value === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
        />
      ))}
    </div>
  );
}
