"use client";

import React, { memo, useRef, useState, useEffect } from 'react';
import { Star, Archive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Email } from '@/lib/types';
import { motion, useAnimation, PanInfo, useMotionValue, useTransform } from 'framer-motion';

export const EmailListItem = memo(({
    email,
    isSelected,
    onSelect,
    onToggleStar,
    onDelete
}: {
    email: Email;
    isSelected: boolean;
    onSelect?: (id: string) => void;
    onToggleStar?: (id: string) => void;
    onDelete?: (id: string) => void;
}) => {
    const [previewText, setPreviewText] = useState(email.preview || "");
    const itemRef = useRef<HTMLDivElement>(null);

    const controls = useAnimation();
    const x = useMotionValue(0);
    // Background becomes visible as we swipe left
    const archiveOpacity = useTransform(x, [0, -50, -100], [0, 0.5, 1]);
    const archiveScale = useTransform(x, [0, -100], [0.8, 1]);

    useEffect(() => {
        setPreviewText(email.preview || "No preview available");
    }, [email.preview]);

    const handleArchive = () => {
        console.log(`gone to archive: ${email.id}`);
        // For now, just snap back
        controls.start({ x: 0, transition: { type: "spring", bounce: 0, duration: 0.4 } });
    };

    const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const offset = info.offset.x;
        const velocity = info.velocity.x;

        // Swiped left far enough or fast enough
        if (offset < -100 || velocity < -500) {
            handleArchive();
        } else {
            // Snap back
            controls.start({ x: 0, transition: { type: "spring", bounce: 0, duration: 0.4 } });
        }
    };

    const wheelAccumulator = useRef(0);
    const isHandlingWheel = useRef(false);

    const handleWheel = (e: React.WheelEvent) => {
        // Trackpad horizontal swipe
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 5) {
            e.stopPropagation(); // Prevent parent containers from interpreting the swipe
            if (isHandlingWheel.current) return;
            
            let currentX = x.get();
            let newX = currentX - e.deltaX; // e.deltaX > 0 means scrolling right / swiping left
            
            // Only allow swiping left (negative x)
            if (newX > 0) newX = 0;
            
            x.set(newX);

            if (newX < -120) {
                isHandlingWheel.current = true;
                handleArchive();
                
                // Reset accumulator after a short delay to prevent double triggers
                setTimeout(() => {
                    isHandlingWheel.current = false;
                }, 500);
            }
        }
    };

    // Ensure we sync the controls with the x motion value
    useEffect(() => {
        controls.set({ x: 0 });
    }, [controls]);

    return (
        <motion.div
            ref={itemRef}
            layoutId={`email-${email.id}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative border-b border-black/5 dark:border-white/5 overflow-hidden group"
            onWheel={handleWheel}
        >
            {/* Archive Background (Revealed on swipe left) */}
            <motion.div 
                className="absolute inset-0 bg-green-500 flex items-center justify-end px-6 z-0"
                style={{ opacity: archiveOpacity }}
            >
                <motion.div style={{ scale: archiveScale }}>
                    <Archive className="text-white w-5 h-5" />
                </motion.div>
            </motion.div>

            {/* Draggable Foreground */}
            <motion.div
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={{ left: 0.2, right: 0 }} // Only allow pulling left elastically
                onDragEnd={handleDragEnd}
                style={{ x }}
                animate={controls}
                whileHover={{ scale: 1.01 }}
                onClick={() => onSelect?.(email.id)}
                className={cn(
                    "px-4 py-4 cursor-pointer transition-all duration-200 relative z-10 bg-background/50 backdrop-blur-md", // Added background to cover archive layer
                    isSelected
                        ? "bg-primary/10 border-l-4 border-l-primary" // Selected
                        : "border-l-4 border-transparent hover:bg-white/40 dark:hover:bg-white/5" // Regular
                )}
            >
                <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleStar?.(email.id);
                            }}
                            className="group/star p-1 -ml-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                        >
                            <Star
                                className={cn(
                                    "w-4 h-4 transition-all duration-200",
                                    email.starred
                                        ? "fill-yellow-400 text-yellow-400 scale-110"
                                        : "text-muted-foreground/40 group-hover/star:text-muted-foreground group-hover/star:scale-110"
                                )}
                            />
                        </button>
                        {email.unread && !isSelected && (
                            <span className="w-2 h-2 rounded-full bg-primary shrink-0 animate-pulse" />
                        )}
                        <span className={cn(
                            "text-sm truncate max-w-[160px] tracking-tight",
                            isSelected || email.unread
                                ? "font-semibold text-foreground dark:text-white/90"
                                : "font-medium text-foreground/80 dark:text-white/70"
                        )}>
                            {email.sender}
                        </span>
                    </div>
                    <span className={cn(
                        "text-[11px] font-medium whitespace-nowrap",
                        isSelected ? "text-primary dark:text-white/90" : "text-muted-foreground dark:text-white/50"
                    )}>
                        {email.time}
                    </span>
                </div>
                <h4 className={cn(
                    "text-sm mb-1 truncate pr-2 tracking-tight",
                    isSelected ? "font-semibold text-foreground/90 dark:text-white/90" : "font-medium text-foreground/70 dark:text-white/70"
                )}>
                    {email.subject}
                </h4>
                <p className="text-xs text-muted-foreground dark:text-white/50 leading-relaxed line-clamp-2">
                    {previewText}
                </p>
            </motion.div>
        </motion.div>
    );
});
EmailListItem.displayName = "EmailListItem";
