import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button, IconButton } from './Button.jsx';

/**
 * Accessible in-app dialog (the app never uses browser alert/confirm).
 */
export function Modal({ open, title, onClose, children, footer, size, closeDisabled }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape' && !closeDisabled) onClose();
    };
    document.addEventListener('keydown', onKey);
    const first = dialogRef.current && dialogRef.current.querySelector('input, select, textarea, button:not([data-close])');
    if (first) first.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous && previous.focus) previous.focus();
    };
  }, [open, onClose, closeDisabled]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !closeDisabled && onClose()}>
      <div ref={dialogRef} className={`modal ${size ? `modal-${size}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} disabled={closeDisabled} data-close />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', tone = 'primary', onConfirm, onClose, loading, children }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      closeDisabled={loading}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      )}
    >
      {message && <p>{message}</p>}
      {children}
    </Modal>
  );
}
