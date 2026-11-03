import React, { useState } from 'react';
import { Tag } from '@/lib/types';
import { useAccountInvoke } from '@/hooks/useAccountInvoke';
import { X, Loader2, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';

interface DeleteTagModalProps {
    tag: Tag;
    onClose: () => void;
    onSuccess: () => void;
}

export const DeleteTagModal: React.FC<DeleteTagModalProps> = ({ tag, onClose, onSuccess }) => {
    const invoke = useAccountInvoke();
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleDelete = async () => {
        setIsDeleting(true);
        setError(null);
        try {
            await invoke('delete_tag', { tagId: tag.id });
            onSuccess();
        } catch (err: unknown) {
            console.error("Failed to delete tag", err);
            setError(err?.toString() || "Failed to delete tag");
            setIsDeleting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={!isDeleting ? onClose : undefined}
            />

            {/* Modal */}
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="relative w-full max-w-md overflow-hidden bg-white/85 dark:bg-[#18181b]/92 backdrop-blur-2xl border border-white/40 dark:border-white/10 rounded-xl shadow-2xl"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 dark:border-white/5">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0">
                            <Trash2 className="w-4 h-4 text-red-500" />
                        </div>
                        <div>
                            <p className="text-[14px] font-semibold text-foreground dark:text-white leading-none">
                                Delete Tag
                            </p>
                            <p className="text-[11px] text-muted-foreground dark:text-white/50 mt-1">
                                Remove this tag and its associations
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isDeleting}
                        className="p-1.5 text-muted-foreground dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors disabled:opacity-50"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-5 space-y-4">
                    <p className="text-sm text-foreground/80 dark:text-white/80 leading-relaxed">
                        Are you sure you want to delete the tag <strong className="font-semibold">{tag.name}</strong>?
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                        This will remove the label from all associated messages, but the messages themselves will not be deleted. This action cannot be undone.
                    </p>

                    {error && (
                        <div className="p-3 bg-red-500/10 text-red-600 dark:text-red-400 text-[13px] rounded-lg border border-red-500/20">
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 flex items-center justify-end gap-2 mt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isDeleting}
                        className="px-4 py-2 text-[13px] font-medium text-foreground/70 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleDelete}
                        disabled={isDeleting}
                        className="px-4 py-2 text-[13px] font-medium bg-red-500 hover:bg-red-600 text-white rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2 shadow-sm"
                    >
                        {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Delete Tag
                    </button>
                </div>
            </motion.div>
        </div>
    );
};
