import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Check, Loader2, Tag as TagIcon } from 'lucide-react';
import { useAccountInvoke } from '@/hooks/useAccountInvoke';
import { toast } from 'sonner';
import { Tag } from '@/lib/types';

// Predefined Gmail compatible colors
const GMAIL_COLORS = [
    { bg: "#fb4c2f", text: "#ffffff", name: "Red" },
    { bg: "#ffad47", text: "#ffffff", name: "Orange" },
    { bg: "#fad165", text: "#000000", name: "Yellow" },
    { bg: "#16a766", text: "#ffffff", name: "Green" },
    { bg: "#43d692", text: "#000000", name: "Light Green" },
    { bg: "#4a86e8", text: "#ffffff", name: "Blue" },
    { bg: "#a479e2", text: "#ffffff", name: "Purple" },
    { bg: "#f691b2", text: "#ffffff", name: "Pink" },
    { bg: "#f6c5be", text: "#000000", name: "Light Red" },
    { bg: "#ffe6c7", text: "#000000", name: "Light Orange" },
    { bg: "#fef1d1", text: "#000000", name: "Light Yellow" },
    { bg: "#b9e4d0", text: "#000000", name: "Pale Green" },
    { bg: "#c6f3de", text: "#000000", name: "Mint" },
    { bg: "#c9daf8", text: "#000000", name: "Light Blue" },
    { bg: "#e4d7f5", text: "#000000", name: "Light Purple" },
    { bg: "#fcdee8", text: "#000000", name: "Light Pink" },
    { bg: "#e66550", text: "#ffffff", name: "Dark Red" },
    { bg: "#ffbc6b", text: "#000000", name: "Amber" },
    { bg: "#fcba03", text: "#000000", name: "Gold" },
    { bg: "#51b749", text: "#ffffff", name: "Emerald" },
    { bg: "#5c86c1", text: "#ffffff", name: "Steel Blue" },
    { bg: "#8e63ce", text: "#ffffff", name: "Deep Purple" },
    { bg: "#e07798", text: "#ffffff", name: "Rose" },
    { bg: "#cc3a21", text: "#ffffff", name: "Crimson" },
    { bg: "#eaa041", text: "#ffffff", name: "Bronze" },
    { bg: "#149e60", text: "#ffffff", name: "Forest Green" },
    { bg: "#683bb7", text: "#ffffff", name: "Indigo" },
    { bg: "#c63a73", text: "#ffffff", name: "Magenta" },
];

const RESERVED_NAMES = ["inbox", "spam", "trash", "sent", "drafts", "unread", "starred"];

interface EditTagModalProps {
    tag: Tag;
    onClose: () => void;
}

export const EditTagModal: React.FC<EditTagModalProps> = ({ tag, onClose }) => {
    const invoke = useAccountInvoke();
    const [name, setName] = useState(() => tag.name.split('/').at(-1) || '');
    const [parentTag, setParentTag] = useState(() => tag.name.split('/').slice(0,-1).join('/'));
    const [selectedColor, setSelectedColor] = useState<{ bg: string, text: string } | null>(() => tag.bg_color && tag.text_color ? {bg:tag.bg_color,text:tag.text_color} : null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [existingTags, setExistingTags] = useState<Tag[]>([]);

    const [lastTag, setLastTag] = useState(tag);
    if (lastTag !== tag) {
        setLastTag(tag);
        const parts = tag.name.split('/');
        const baseName = parts.pop() || '';
        const parent = parts.join('/');
        
        setName(baseName);
        setParentTag(parent);
        setSelectedColor(tag.bg_color && tag.text_color ? {bg:tag.bg_color,text:tag.text_color} : null);
    }

    useEffect(() => {
        invoke<Tag[]>('get_all_tags')
            .then(setExistingTags)
            .catch(console.error);
    }, [invoke]);

    const trimmedName = name.trim();
    const fullName = parentTag ? `${parentTag}/${trimmedName}` : trimmedName;
    const isNameChanged = fullName !== tag.name;
    const isColorChanged = selectedColor?.bg !== tag.bg_color;

    let validationError = "";
    if (!trimmedName) {
        validationError = "Tag name cannot be empty";
    } else if (trimmedName.includes('/')) {
        validationError = "Tag name cannot contain '/' (use the Parent Tag dropdown instead)";
    } else if (fullName.length > 225) {
        validationError = "Tag name cannot exceed 225 characters";
    } else if (RESERVED_NAMES.includes(trimmedName.toLowerCase()) || RESERVED_NAMES.includes(fullName.toLowerCase())) {
        validationError = "Cannot use reserved system label names";
    } else if (existingTags.some(t => t.id !== tag.id && t.name.toLowerCase() === fullName.toLowerCase())) {
        validationError = "A tag with this name already exists";
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (validationError) {
            toast.error(validationError);
            return;
        }

        if (!isNameChanged && !isColorChanged) {
            onClose();
            return;
        }

        setIsSubmitting(true);
        try {
            await invoke('update_tag', {
                tagId: tag.id,
                name: fullName,
                bgColor: selectedColor?.bg || null,
                textColor: selectedColor?.text || null
            });
            toast.success('Tag updated successfully');
            onClose();
        } catch (error) {
            console.error('Failed to update tag:', error);
            toast.error('Failed to update tag', { description: String(error) });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
            />
            
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="relative w-full max-w-md overflow-hidden bg-white/85 dark:bg-[#18181b]/92 backdrop-blur-2xl border border-white/40 dark:border-white/10 rounded-xl shadow-2xl"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 dark:border-white/5">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <TagIcon className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                            <p className="text-[14px] font-semibold text-foreground dark:text-white leading-none">
                                Edit Tag
                            </p>
                            <p className="text-[11px] text-muted-foreground dark:text-white/50 mt-1">
                                Update the tag name, hierarchy, or color
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 text-muted-foreground dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="p-5 space-y-5">
                    <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-foreground/80 dark:text-white/80">
                            Tag Name
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Invoices"
                            className="w-full text-sm bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 outline-none text-foreground dark:text-white placeholder:text-muted-foreground/40 dark:placeholder:text-white/25 transition-all duration-150 focus:ring-2 focus:ring-primary/35"
                            autoFocus
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-foreground/80 dark:text-white/80">
                            Nest under (Optional)
                        </label>
                        <select
                            value={parentTag}
                            onChange={(e) => setParentTag(e.target.value)}
                            className="w-full text-sm bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 outline-none text-foreground dark:text-white transition-all duration-150 focus:ring-2 focus:ring-primary/35 appearance-none cursor-pointer"
                        >
                            <option value="" className="bg-white dark:bg-[#18181b]">None (Top level)</option>
                            {existingTags.filter(t => t.tag_type === 'user' && !t.name.startsWith(tag.name)).map(t => (
                                <option key={t.id} value={t.name} className="bg-white dark:bg-[#18181b]">
                                    {t.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-[12px] font-medium text-foreground/80 dark:text-white/80">
                                Color (Optional)
                            </label>
                            {selectedColor && (
                                <button
                                    type="button"
                                    onClick={() => setSelectedColor(null)}
                                    className="text-[10px] text-primary hover:text-primary/80 transition-colors font-medium"
                                >
                                    Clear color
                                </button>
                            )}
                        </div>
                        <div className="grid grid-cols-8 gap-2">
                            {GMAIL_COLORS.map((color, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setSelectedColor(color)}
                                    className={`w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-sm ${selectedColor?.bg === color.bg ? 'scale-110 ring-2 ring-offset-2 ring-primary dark:ring-offset-[#18181b]' : 'hover:scale-110'}`}
                                    style={{ backgroundColor: color.bg, color: color.text }}
                                    title={color.name}
                                >
                                    {selectedColor?.bg === color.bg && <Check className="w-3.5 h-3.5" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="flex justify-end gap-2 pt-5 border-t border-black/5 dark:border-white/5 mt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-[12px] font-medium rounded-lg text-muted-foreground dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/8 transition-colors"
                        >
                            Cancel
                        </button>
                        <div title={validationError || (!isNameChanged && !isColorChanged ? "No changes made" : "")}>
                            <button
                                type="submit"
                                disabled={isSubmitting || !!validationError || (!isNameChanged && !isColorChanged)}
                                className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 transition-colors shadow-sm shadow-primary/20"
                            >
                                {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                Save Changes
                            </button>
                        </div>
                    </div>
                </form>
            </motion.div>
        </div>
    );
};
