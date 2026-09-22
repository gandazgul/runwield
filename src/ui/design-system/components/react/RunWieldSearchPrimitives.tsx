import { useEffect, useRef } from "react";

interface SearchDialogProps {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
}

export function RunWieldSearchDialog({ open, onClose, children }: SearchDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) {
            returnFocusRef.current = document.activeElement as HTMLElement | null;
            dialog.showModal();
        }
        if (!open) {
            if (dialog.open) dialog.close();
            returnFocusRef.current?.focus();
            returnFocusRef.current = null;
        }
    }, [open]);

    function trapFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
        if (event.key !== "Tab") return;
        const focusable = [...dialogRef.current!.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )];
        if (!focusable.length) {
            event.preventDefault();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    return (
        <dialog ref={dialogRef} className="rw-workspace-search-modal" onClose={onClose} onKeyDown={trapFocus}>
            {children}
        </dialog>
    );
}

interface SearchContainerProps {
    children: React.ReactNode;
    label?: string;
}

export function RunWieldSearchFilters({ children }: SearchContainerProps) {
    return <div className="rw-workspace-search-filters">{children}</div>;
}

export function RunWieldSearchResults({ children, label = "Search results" }: SearchContainerProps) {
    return <ol className="rw-workspace-search-results" aria-label={label}>{children}</ol>;
}
