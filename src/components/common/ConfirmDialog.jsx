import React from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from './Modal.jsx';
import Button from './Button.jsx';

export default function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel = 'Delete',
  loading = false, danger = true,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        {danger && (
          <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/30 grid place-items-center text-rose-300 shrink-0">
            <AlertTriangle size={18} />
          </div>
        )}
        <div className="text-sm text-slate-300 leading-relaxed">{message}</div>
      </div>
    </Modal>
  );
}
