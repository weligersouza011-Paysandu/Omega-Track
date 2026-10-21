import { useEffect, useId } from 'react';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, subtitle, children, size = 'md', footer }) {
  const tituloId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
    full: 'max-w-[95vw]',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-omega-900/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative w-full ${sizes[size]} bg-white rounded-2xl shadow-2xl border border-omega-100 flex flex-col max-h-[90vh]`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-omega-100">
          <div className="min-w-0">
            <h2 id={tituloId} className="text-lg font-bold text-omega-900">{title}</h2>
            {subtitle && <p className="text-sm text-omega-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-lg hover:bg-omega-100 text-omega-500 hover:text-omega-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 overflow-auto flex-1">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-omega-100 bg-omega-50/50 rounded-b-2xl flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
