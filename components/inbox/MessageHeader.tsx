"use client";

import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { File, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Email } from '@/lib/types';

export const MessageHeader = memo(({ email }: { email: Email }) => (
    <header className="mb-8">
        <motion.h1
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold tracking-tight text-foreground dark:text-white/90 mb-6 leading-tight"
        >
            {email.subject}
        </motion.h1>
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
                <div
                    className="w-12 h-12 rounded-full bg-cover bg-center border border-border"
                    style={{ backgroundImage: `url('${email?.avatar || ""}')` }}
                />
                <div>
                    <div className="flex items-center gap-2">
                        <span className="font-bold tracking-tight text-foreground dark:text-white/90">{email.sender}</span>
                        <span className="text-muted-foreground dark:text-white/50 text-sm">&lt;{email.senderEmail}&gt;</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-sm text-muted-foreground dark:text-white/50">To:</span>
                        <span className="text-sm font-medium text-foreground/80 dark:text-white/70">Arunabha Jana</span>
                    </div>
                </div>
            </div>
            <span className="text-sm font-medium text-muted-foreground dark:text-white/50">
                {email.date}
            </span>
        </div>
    </header>
));
MessageHeader.displayName = "MessageHeader";

export const AttachmentCard = memo(({ attachment }: { attachment: { name: string; size: string; type: string } }) => (
    <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={cn(
            "mt-8 p-3 rounded-xl flex items-center gap-4 max-w-sm transition-colors",
            "border border-border bg-muted/30 hover:bg-muted/50"
        )}
    >
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10 text-primary">
            <File className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{attachment.name}</p>
            <p className="text-xs text-muted-foreground">{attachment.size} • {attachment.type}</p>
        </div>
        <button className="p-2 text-muted-foreground hover:text-primary transition-colors">
            <Download className="w-5 h-5" />
        </button>
    </motion.div>
));
AttachmentCard.displayName = "AttachmentCard";
