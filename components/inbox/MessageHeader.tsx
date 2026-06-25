"use client";

import React, { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { File, Download, FileText, Image as ImageIcon, FileArchive, FileCode, Video, Music, Presentation, Table, FileSpreadsheet, FileAudio, FileVideo, FileType, Check, Copy } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { cn } from '@/lib/utils';
import { Email, Attachment } from '@/lib/types';
import { useDownloads } from '@/components/DownloadContext';
import { toast } from 'sonner';

const parseContact = (raw: string) => {
    if (!raw) return { name: '', email: '' };
    const cleaned = raw.replace(/^<+|<+$/g, '').trim();
    const match = raw.match(/(.*?)\s*<([^>]+)>/);
    if (match) {
        let name = match[1].replace(/["']/g, '').trim();
        let email = match[2].replace(/[<>]/g, '').trim();
        if (name.includes('<')) {
            const subMatch = name.match(/(.*?)\s*<([^>]+)/);
            if (subMatch) name = subMatch[1].trim();
        }
        if (!name) name = email.split('@')[0];
        return { name, email };
    }
    const plain = raw.replace(/[<>]/g, '').trim();
    if (plain.includes('@')) {
        return { name: plain.split('@')[0], email: plain };
    }
    return { name: plain, email: '' };
};

const getSenderInfo = (sender: string, senderEmail: string) => {
    const fromEmail = parseContact(senderEmail || sender);
    const fromSender = parseContact(sender || senderEmail);
    const finalEmail = fromEmail.email || fromSender.email || senderEmail;
    let finalName = fromSender.name || fromEmail.name || sender;
    if (finalName.toLowerCase() === finalEmail.toLowerCase()) {
        finalName = finalName.split('@')[0];
    }
    return { name: finalName, email: finalEmail };
};

const parseRecipients = (toStr: string) => {
    if (!toStr) return [{ name: 'Me', email: '' }];
    const parts = toStr.split(',');
    const results = parts.map(p => parseContact(p.trim())).filter(c => c.name || c.email);
    if (results.length === 0) return [{ name: 'Me', email: '' }];
    return results;
};

const getRelativeTime = (dateStr: string) => {
    if (!dateStr) return '';
    try {
        let d = new Date(dateStr);
        if (isNaN(d.getTime())) {
            const parts = dateStr.split(',');
            if (parts.length >= 1) {
                const dateParts = parts[0].trim().split('/');
                if (dateParts.length === 3) {
                    const day = parseInt(dateParts[0], 10);
                    const month = parseInt(dateParts[1], 10) - 1;
                    const year = parseInt(dateParts[2], 10);
                    const timePart = parts[1] ? parts[1].trim() : '';
                    d = new Date(year, month, day);
                    if (timePart) {
                        const timeMatch = timePart.match(/(\d+):(\d+)(?::(\d+))?\s*(am|pm)?/i);
                        if (timeMatch) {
                            let hours = parseInt(timeMatch[1], 10);
                            const minutes = parseInt(timeMatch[2], 10);
                            const ampm = timeMatch[4]?.toLowerCase();
                            if (ampm === 'pm' && hours < 12) hours += 12;
                            if (ampm === 'am' && hours === 12) hours = 0;
                            d.setHours(hours, minutes, 0, 0);
                        }
                    }
                }
            }
        }

        if (isNaN(d.getTime())) return '';

        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        if (diffMs < 0) return 'Just now';

        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24 && now.getDate() === d.getDate()) {
            return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        }
        if (diffHours < 48 && now.getDate() !== d.getDate()) {
            return 'Yesterday';
        }
        return `${diffDays} days ago`;
    } catch (e) {
        return '';
    }
};

const formatSimplifiedDateTime = (dateStr: string) => {
    if (!dateStr) return '';
    try {
        let d = new Date(dateStr);
        if (isNaN(d.getTime())) {
            const parts = dateStr.split(',');
            if (parts.length >= 1) {
                const dateParts = parts[0].trim().split('/');
                if (dateParts.length === 3) {
                    const day = parseInt(dateParts[0], 10);
                    const month = parseInt(dateParts[1], 10) - 1;
                    const year = parseInt(dateParts[2], 10);
                    const timePart = parts[1] ? parts[1].trim() : '';
                    d = new Date(year, month, day);
                    if (timePart) {
                        const timeMatch = timePart.match(/(\d+):(\d+)(?::(\d+))?\s*(am|pm)?/i);
                        if (timeMatch) {
                            let hours = parseInt(timeMatch[1], 10);
                            const minutes = parseInt(timeMatch[2], 10);
                            const ampm = timeMatch[4]?.toLowerCase();
                            if (ampm === 'pm' && hours < 12) hours += 12;
                            if (ampm === 'am' && hours === 12) hours = 0;
                            d.setHours(hours, minutes, 0, 0);
                        }
                    }
                }
            }
        }

        if (isNaN(d.getTime())) {
            return dateStr.replace(/(\d+:\d+):\d+\s*(am|pm)/i, '$1 $2').toUpperCase();
        }

        const now = new Date();
        const isCurrentYear = d.getFullYear() === now.getFullYear();
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = d.getDate();
        const month = monthNames[d.getMonth()];
        const year = d.getFullYear();
        
        let hours = d.getHours();
        const minutes = d.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12; // convert 0 to 12
        const minsStr = minutes < 10 ? '0' + minutes : minutes;

        const timeStr = `${hours}:${minsStr} ${ampm}`;

        if (isCurrentYear) {
            return `${day} ${month}, ${timeStr}`;
        } else {
            return `${day} ${month} ${year}, ${timeStr}`;
        }
    } catch (e) {
        return dateStr;
    }
};

export const MessageHeader = memo(({ email }: { email: Email }) => {
    const [showToast, setShowToast] = useState(false);
    const [isToExpanded, setIsToExpanded] = useState(false);

    const senderInfo = getSenderInfo(email.sender || '', email.senderEmail || '');
    const recipients = parseRecipients(email.to || '');
    const relativeTime = getRelativeTime(email.date || '');
    const simplifiedDateTime = formatSimplifiedDateTime(email.date || '');

    const handleCopyText = (text: string) => {
        if (text) {
            navigator.clipboard.writeText(text.trim());
            setShowToast(true);
            setTimeout(() => setShowToast(false), 2000);
        }
    };

    return (
        <header className="mb-8 relative">
            <motion.h1
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-2xl font-bold tracking-tight text-foreground dark:text-white/90 mb-6 leading-tight"
            >
                {email.subject}
            </motion.h1>

            <div className="flex items-start justify-between gap-4 bg-white/40 dark:bg-white/5 backdrop-blur-md border border-white/20 dark:border-white/10 rounded-2xl p-4 shadow-sm">
                <div className="flex flex-col gap-3 flex-1 min-w-0">
                    {/* Centered Avatar + From/To block */}
                    <div className="flex items-center gap-4 w-full">
                        <div
                            className="w-12 h-12 rounded-full bg-cover bg-center border border-border shrink-0"
                            style={{ backgroundImage: `url('${email?.avatar || ""}')` }}
                        />
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                            <div className="relative">
                                <div 
                                    onClick={() => handleCopyText(senderInfo.email)}
                                    className="flex items-center gap-2 cursor-pointer group rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors px-2 py-1 -ml-2 w-fit select-none"
                                    title="Click to copy sender email"
                                >
                                    <span className="text-sm font-normal text-muted-foreground dark:text-white/50 select-none pr-1">From</span>
                                    <span className="font-bold tracking-tight text-foreground dark:text-white/90 group-hover:text-primary transition-colors truncate">{senderInfo.name}</span>
                                    {senderInfo.email && (
                                        <span className="text-muted-foreground dark:text-white/50 text-sm group-hover:text-primary/70 transition-colors truncate">&lt;{senderInfo.email}&gt;</span>
                                    )}
                                    <Copy className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-primary transition-opacity shrink-0" />
                                </div>
                                <AnimatePresence>
                                    {showToast && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 5, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: -5, scale: 0.95 }}
                                            className="absolute left-0 -top-8 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/80 dark:bg-white/90 text-white dark:text-black backdrop-blur-md shadow-lg"
                                        >
                                            <Check className="w-3.5 h-3.5" />
                                            <span className="text-xs font-semibold tracking-tight">Email copied</span>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* To / Recipients Inline Row */}
                            <div className="flex items-center gap-2 flex-wrap text-sm">
                                <span className="text-sm font-normal text-muted-foreground dark:text-white/50 select-none pr-1">To</span>
                                {recipients.slice(0, 2).map((recip, idx) => (
                                    <div 
                                        key={idx} 
                                        onClick={() => recip.email ? handleCopyText(recip.email) : null}
                                        className={cn(
                                            "flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-colors",
                                            recip.email ? "hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer group" : ""
                                        )}
                                        title={recip.email ? "Click to copy recipient email" : ""}
                                    >
                                        <span className="font-medium text-foreground/80 dark:text-white/80 group-hover:text-primary transition-colors">{recip.name}</span>
                                        {recip.email && recip.email !== recip.name && (
                                            <span className="text-xs text-muted-foreground dark:text-white/40 group-hover:text-primary/70 transition-colors">&lt;{recip.email}&gt;</span>
                                        )}
                                    </div>
                                ))}
                                {recipients.length > 2 && (
                                    <button
                                        onClick={() => setIsToExpanded(!isToExpanded)}
                                        className="px-2 py-0.5 rounded-md bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold transition-colors select-none"
                                    >
                                        {isToExpanded ? "Show less" : `+${recipients.length - 2} more`}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Expanded Recipients View */}
                    <AnimatePresence>
                        {isToExpanded && recipients.length > 2 && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden border-t border-black/5 dark:border-white/10 pt-3"
                            >
                                <div className="text-xs font-bold text-muted-foreground/60 dark:text-white/40 mb-2 uppercase tracking-wider px-2">All Recipients ({recipients.length})</div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto pr-2">
                                    {recipients.map((recip, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => recip.email ? handleCopyText(recip.email) : null}
                                            className="flex items-center justify-between p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer group transition-colors"
                                        >
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span className="font-medium text-foreground/80 dark:text-white/80 group-hover:text-primary transition-colors truncate">{recip.name}</span>
                                                {recip.email && recip.email !== recip.name && (
                                                    <span className="text-xs text-muted-foreground dark:text-white/40 group-hover:text-primary/70 transition-colors truncate">&lt;{recip.email}&gt;</span>
                                                )}
                                            </div>
                                            <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 text-primary transition-opacity shrink-0 ml-2" />
                                        </div>
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Two-Line Timestamp Section */}
                <div className="flex flex-col items-end gap-1 shrink-0 select-none mt-0.5">
                    {relativeTime && (
                        <span className="text-xs font-semibold text-primary/90">
                            {relativeTime}
                        </span>
                    )}
                    <span className="text-xs font-medium text-muted-foreground dark:text-white/50">
                        {simplifiedDateTime}
                    </span>
                </div>
            </div>
        </header>
    );
});
MessageHeader.displayName = "MessageHeader";

const getFileIcon = (mime: string | undefined) => {
    if (!mime) return <File className="w-5 h-5" />;
    const m = mime.toLowerCase();

    // Spreadsheets
    if (m.includes('spreadsheet') || m.includes('excel') || m.includes('csv')) return <FileSpreadsheet className="w-5 h-5" />;

    // Images
    if (m.includes('image')) return <ImageIcon className="w-5 h-5" />;

    // Documents
    if (m.includes('pdf')) return <FileType className="w-5 h-5" />; // Use FileType for PDF as it looks distinct
    if (m.includes('word') || m.includes('officedocument.wordprocessingml') || m.includes('document')) return <FileText className="w-5 h-5" />;

    // Presentation
    if (m.includes('presentation') || m.includes('powerpoint')) return <Presentation className="w-5 h-5" />;

    // Video/Audio
    if (m.includes('video')) return <FileVideo className="w-5 h-5" />;
    if (m.includes('audio')) return <FileAudio className="w-5 h-5" />;

    // Archives
    if (m.includes('zip') || m.includes('rar') || m.includes('archive') || m.includes('compressed')) return <FileArchive className="w-5 h-5" />;

    // Code
    if (m.includes('javascript') || m.includes('json') || m.includes('html') || m.includes('code') || m.includes('rust') || m.includes('text/plain')) return <FileCode className="w-5 h-5" />;

    return <File className="w-5 h-5" />;
};

const getShortType = (mime: string | undefined): string => {
    if (!mime) return "FILE";
    const m = mime.toLowerCase();
    if (m.includes('spreadsheetml.sheet') || m.includes('excel')) return "XLSX";
    if (m.includes('wordprocessingml.document') || m.includes('word')) return "DOCX";
    if (m.includes('presentationml.presentation') || m.includes('powerpoint')) return "PPTX";
    if (m.includes('pdf')) return "PDF";
    if (m.includes('image/png')) return "PNG";
    if (m.includes('image/jpeg')) return "JPG";
    if (m.includes('image/svg')) return "SVG";
    if (m.includes('video/mp4')) return "MP4";
    if (m.includes('audio/mpeg')) return "MP3";
    if (m.includes('text/plain')) return "TXT";
    if (m.includes('text/csv')) return "CSV";
    if (m.includes('zip')) return "ZIP";

    const parts = m.split('/');
    const lastPart = parts[parts.length - 1];
    if (lastPart.length > 5) {
        if (lastPart.includes('.')) return lastPart.split('.').pop()?.toUpperCase() || "FILE";
        return lastPart.substring(0, 4).toUpperCase();
    }
    return lastPart.toUpperCase();
};

const getTypeColor = (mime: string | undefined): string => {
    if (!mime) return "primary";
    const m = mime.toLowerCase();
    if (m.includes('spreadsheet') || m.includes('excel') || m.includes('csv')) return "att-excel";
    if (m.includes('word') || m.includes('document')) return "att-word";
    if (m.includes('pdf')) return "att-pdf";
    if (m.includes('presentation') || m.includes('powerpoint')) return "att-ppt";
    if (m.includes('video')) return "att-video";
    if (m.includes('audio')) return "att-audio";
    if (m.includes('image')) return "att-image";
    if (m.includes('code') || m.includes('javascript') || m.includes('rust')) return "att-code";
    return "primary";
};

export const AttachmentCard = memo(({ uid, folder, attachment }: { uid: number, folder: string, attachment: Attachment }) => {
    const [isDownloading, setIsDownloading] = React.useState(false);
    const { addDownload, updateDownloadStatus } = useDownloads();

    const handleDownload = async () => {
        setIsDownloading(true);
        try {
            // Ask user for save location
            const savePath = await save({
                defaultPath: attachment.name,
                title: "Save Attachment",
            });

            if (!savePath) {
                // User cancelled the dialog
                setIsDownloading(false);
                return;
            }

            // Register in the global download manager
            const downloadId = addDownload(attachment.name);

            // Execute backend download
            // Since imap fetch blocks, we don't have true byte-level progress in NextJS easily.
            // The context will show "downloading" spinner until the IPC call returns.
            const resultPath = await invoke<string>('download_attachment', {
                folder: folder === "sent" ? "sent" : "INBOX",
                uid,
                partId: attachment.partId,
                savePath: savePath
            });
            console.log(`Downloaded to ${resultPath}`);
            updateDownloadStatus(downloadId, 'completed', resultPath);
            toast.success("Attachment downloaded successfully");
        } catch (err) {
            console.error("Download failed:", err);
            toast.error("Failed to download attachment", { description: String(err) });
        } finally {
            setIsDownloading(false);
        }
    };

    const typeColor = getTypeColor(attachment.type);

    const shortType = getShortType(attachment.type);

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -4, scale: 1.02 }}
            className={cn(
                "group p-3 rounded-2xl flex items-center gap-4 transition-all duration-500",
                "border border-white/20 dark:border-white/10 bg-white/40 dark:bg-white/5 backdrop-blur-md",
                "hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.3)]",
                "hover:border-primary/40"
            )}
        >
            <div className={cn(
                "w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center transition-all duration-500",
                "bg-primary/5 text-primary group-hover:bg-primary/10",
                typeColor !== "primary" && `text-${typeColor} bg-${typeColor}/5 group-hover:bg-${typeColor}/10`
            )}>
                <div className="group-hover:scale-110 transition-transform duration-500">
                    {getFileIcon(attachment.type)}
                </div>
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <p
                    className="text-sm font-bold text-foreground/90 dark:text-white/90 line-clamp-2 leading-tight group-hover:text-primary transition-colors duration-300"
                    title={attachment.name}
                >
                    {attachment.name}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-1 min-w-0">
                    <div className={cn(
                        "px-1.5 py-0.5 rounded-md text-[9px] font-black tracking-widest uppercase",
                        "bg-primary/10 text-primary",
                        typeColor !== "primary" && `bg-${typeColor}/10 text-${typeColor}`
                    )}>
                        {shortType}
                    </div>
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/30 dark:bg-white/10" />
                    <span className="text-[10px] font-bold text-muted-foreground/60 dark:text-white/30 uppercase tracking-tighter">
                        {attachment.size}
                    </span>
                </div>
            </div>
            <button
                onClick={handleDownload}
                disabled={isDownloading}
                className={cn(
                    "w-10 h-10 shrink-0 rounded-xl flex items-center justify-center transition-all duration-300",
                    "bg-primary/5 text-primary hover:bg-primary hover:text-white shadow-sm",
                    "opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0",
                    isDownloading && "animate-pulse opacity-100"
                )}
            >
                {isDownloading ? (
                    <div className="h-5 w-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                    <Download className="w-5 h-5" />
                )}
            </button>
        </motion.div>
    );
});
AttachmentCard.displayName = "AttachmentCard";
