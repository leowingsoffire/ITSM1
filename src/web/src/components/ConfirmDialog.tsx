import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue>({ confirm: () => Promise.resolve(false) });

export function useConfirm() {
  return useContext(ConfirmContext);
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      setPending({ ...options, resolve });
    });
  }, []);

  function handleResult(result: boolean) {
    pending?.resolve(result);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div className="confirm-overlay" onClick={() => handleResult(false)}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <h3 className="confirm-title">{pending.title}</h3>
            <p className="confirm-message">{pending.message}</p>
            <div className="confirm-actions">
              <button className="btn btn-outline" onClick={() => handleResult(false)}>
                {pending.cancelText || 'Cancel'}
              </button>
              <button
                className={`btn ${pending.variant === 'danger' ? 'btn-danger' : pending.variant === 'warning' ? 'btn-warning' : 'btn-primary'}`}
                onClick={() => handleResult(true)}
              >
                {pending.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
