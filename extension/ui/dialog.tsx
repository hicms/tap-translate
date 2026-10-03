import type { ReactNode } from 'react';
import { Dialog as AstryxDialog, DialogHeader } from '@astryxdesign/core/Dialog';

export function Dialog({
  id,
  title,
  open,
  onClose,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <AstryxDialog
      id={id}
      isOpen={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      width="min(540px, calc(100vw - 32px))"
      maxHeight="calc(100dvh - 32px)"
      className="app-dialog"
    >
      <DialogHeader title={title} className="app-dialog-header" />
      <div className="app-dialog-body">{children}</div>
    </AstryxDialog>
  );
}
