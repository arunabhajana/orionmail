"use client";
import React, { memo, useRef, useState } from 'react';
import { File, Download, FileText, Image as ImageIcon, FileArchive, FileCode, Presentation, FileSpreadsheet, FileAudio, FileVideo, FileType, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { Attachment } from '@/lib/types';
import { useDownloads } from '@/components/DownloadContext';
import { toast } from 'sonner';
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


export const AttachmentCard = memo(({ uid, folder, attachment }: { uid: number; folder: string; attachment: Attachment }) => {
    const [downloading, setDownloading] = useState(false);
    const busy = useRef(false);
    const { addDownload, updateDownloadStatus } = useDownloads();
    const download = async () => {
        if (busy.current) return;
        busy.current = true;
        setDownloading(true);
        let downloadId: string | undefined;
        try {
            const savePath = await save({ defaultPath: attachment.name, title: 'Save attachment' });
            if (!savePath) return;
            downloadId = addDownload(attachment.name);
            const resultPath = await invoke<string>('download_attachment', { folder: folder || 'inbox', uid, partId: attachment.partId, savePath });
            updateDownloadStatus(downloadId, 'completed', resultPath);
            toast.success('Attachment saved.');
        } catch (error) {
            if (downloadId) updateDownloadStatus(downloadId, 'error');
            toast.error('Could not save attachment.', { description: String(error) });
        } finally { busy.current = false; setDownloading(false); }
    };
    const color = `var(--color-${getTypeColor(attachment.type)})`;
    return <div data-context-menu="attachment" className="mail-attachment-card">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>{getFileIcon(attachment.type)}</div>
        <div className="min-w-0 flex-1"><p className="line-clamp-2 break-words text-xs font-medium leading-5 text-foreground" title={attachment.name}>{attachment.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{getShortType(attachment.type)}<span aria-hidden="true" className="mx-1.5">·</span>{attachment.size}</p></div>
        <button type="button" aria-label={`Save ${attachment.name}`} title="Save attachment" disabled={downloading} onClick={download} className="mail-icon-button shrink-0">{downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}</button>
    </div>;
});
AttachmentCard.displayName = 'AttachmentCard';
