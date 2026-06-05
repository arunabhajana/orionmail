"use client";

import React, { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { File, Download, FileText, Image as ImageIcon, FileArchive, FileCode, Video, Music, Presentation, Table, FileSpreadsheet, FileAudio, FileVideo, FileType, Check, Copy } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { cn } from '@/lib/utils';
import { Email, Attachment } from '@/lib/types';
import { useDownloads } from '@/components/DownloadContext';

export const MessageHeader = memo(({ email }: { email: Email }) => {
    const [showToast, setShowToast] = useState(false);

    const handleCopyEmail = () => {
        if (email.senderEmail) {
            // Extract just the email address if it's in the format "Name" <email@domain.com>
            const extractedEmail = email.senderEmail.match(/<([^>]+)>/)?.[1] || email.senderEmail;
            navigator.clipboard.writeText(extractedEmail.trim());
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
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div
                        className="w-12 h-12 rounded-full bg-cover bg-center border border-border"
                        style={{ backgroundImage: `url('${email?.avatar || ""}')` }}
                    />
                    <div>
                        <div className="relative">
                            <div 
                                onClick={handleCopyEmail}
                                className="flex items-center gap-2 cursor-pointer group rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors px-2 py-1 -ml-2 select-none"
                                title="Click to copy email address"
                            >
                                <span className="font-bold tracking-tight text-foreground dark:text-white/90 group-hover:text-primary transition-colors">{email.sender}</span>
                                <span className="text-muted-foreground dark:text-white/50 text-sm group-hover:text-primary/70 transition-colors">&lt;{email.senderEmail}&gt;</span>
                                <Copy className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-primary transition-opacity" />
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
                        <div className="flex items-center gap-2 mt-0.5 px-0">
                            <span className="text-sm text-muted-foreground dark:text-white/50">To:</span>
                            <span className="text-sm font-medium text-foreground/80 dark:text-white/70">{email.to || "Me"}</span>
                        </div>
                    </div>
                </div>
                <span className="text-sm font-medium text-muted-foreground dark:text-white/50">
                    {email.date}
                </span>
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
        } catch (err) {
            console.error("Download failed:", err);
            alert(`Download failed: ${err}`);
            // If we had the downloadId here, we could mark it as error it, but addDownload might not have fired if dialog failed.
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
