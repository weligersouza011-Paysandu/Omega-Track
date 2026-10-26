import { useEffect, useId } from 'react';
import { X } from 'lucide-react';

export default function Modal({
  open,
  aberto,
  onClose,
  aoFechar,
  title,
  titulo,
  subtitle,
  subtitulo,
  children,
  size = 'md',
  largura,
  footer,
}) {
  const isAberto = Boolean(open ?? aberto);
  const handleFechar = onClose || aoFechar;
  const modalTitle = title || titulo;
  const modalSubtitle = subtitle || subtitulo;
  const tituloId = useId();

  useEffect(() => {
    if (!isAberto) return;
    const onKey = (e) => e.key === 'Escape' && handleFechar?.();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isAberto, handleFechar]);

  if (!isAberto) return null;

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
    full: 'max-w-[95vw]',
  };

  const classeLargura = largura || sizes[size] || sizes.md;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-omega-950/70 backdrop-blur-sm" onClick={handleFechar} />
      <div
        className={`relative w-full ${classeLargura} bg-white dark:bg-omega-900 rounded-2xl shadow-2xl border border-omega-100 dark:border-omega-800 flex flex-col max-h-[90vh] transition-all`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-omega-100 dark:border-omega-800">
          <div className="min-w-0">
            <h2 id={tituloId} className="text-lg font-bold text-omega-900 dark:text-white">
              {modalTitle}
            </h2>
            {modalSubtitle && (
              <p className="text-sm text-omega-500 dark:text-omega-400 mt-0.5">
                {modalSubtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleFechar}
            className="p-2 -mr-2 rounded-lg hover:bg-omega-100 dark:hover:bg-omega-800 text-omega-500 hover:text-omega-800 dark:hover:text-omega-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 overflow-auto flex-1">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-omega-100 dark:border-omega-800 bg-omega-50/50 dark:bg-omega-950/50 rounded-b-2xl flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
