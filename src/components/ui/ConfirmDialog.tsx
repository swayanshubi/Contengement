"use client";

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    danger = false,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    if (!open) return null;

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
                <p className="text-sm text-zinc-400 mt-2">{message}</p>
                <div className="mt-5 flex justify-end gap-2">
                    <button onClick={onCancel} className="btn-secondary text-sm px-3 py-1.5">
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={danger ? "btn-danger text-sm px-3 py-1.5" : "btn-primary text-sm px-3 py-1.5"}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
