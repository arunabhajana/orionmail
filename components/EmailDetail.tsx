"use client";

import React, { memo } from 'react';
import {
    Archive,
    Trash2,
    Reply,
    MoreVertical,
    AlertOctagon,
    File,
    Download,
    Star
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Email } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import DOMPurify from 'isomorphic-dompurify';
import sanitizeHtml from 'sanitize-html';
import { useTheme } from 'next-themes';
import { DetailToolbar } from './inbox/DetailToolbar';
import { MessageHeader, AttachmentCard } from './inbox/MessageHeader';
import { useEmailBody } from '@/hooks/useEmailBody';

// --- Types ---

interface EmailDetailProps {
    className?: string;
    email?: Email | null;
    onToggleStar?: (emailId: string) => void;
    onDeleteMessage?: (emailId: string) => void;
    onMarkAsRead?: (emailId: string) => void;
}

// --- Main Component ---

const EmailDetail: React.FC<EmailDetailProps> = ({ className, email, onToggleStar, onDeleteMessage, onMarkAsRead }) => {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';

    const { bodyContent, isLoadingBody, iframeHeight } = useEmailBody(
        email?.id,
        email?.unread,
        onMarkAsRead
    );

    if (!email) {
        return (
            <section className={cn(
                "flex flex-col h-full items-center justify-center text-muted-foreground gap-4 transition-colors",
                "bg-white/40 dark:bg-black/20 backdrop-blur-3xl", // Glass effect
                className
            )}>
                <div className="w-16 h-16 rounded-2xl bg-black/5 dark:bg-white/10 flex items-center justify-center">
                    <File className="w-8 h-8 opacity-50" />
                </div>
                <div className="text-center">
                    <h3 className="font-semibold text-foreground text-lg">No Message Selected</h3>
                    <p className="text-sm opacity-70">Select an email to view its details</p>
                </div>
            </section>
        );
    }

    return (
        <section
            className={cn(
                "flex flex-col h-full bg-white dark:bg-[#111111] transition-colors",
                className
            )}
        >
            <DetailToolbar
                isStarred={email?.starred}
                onToggleStar={() => email && onToggleStar?.(email.id)}
                onDelete={() => email && onDeleteMessage?.(email.id)}
            />

            {/* Content Scroll Area */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={email.id}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.2 }}
                        className="w-full max-w-5xl mx-auto"
                    >
                        <MessageHeader email={email} />

                        {isLoadingBody ? (
                            <div className="flex h-32 items-center justify-center">
                                <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary"></div>
                                <span className="ml-3 text-sm text-muted-foreground animate-pulse">Fetching message body...</span>
                            </div>
                        ) : (
                            <iframe
                                title="Email Content"
                                className="w-full border-0 email-content-iframe bg-white dark:bg-[#111111]"
                                sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
                                scrolling="no"
                                style={{ height: `${iframeHeight}px`, overflow: 'hidden' }}
                                srcDoc={`
                                    <!DOCTYPE html>
                                    <html>
                                    <head>
                                        <meta charset="utf-8">
                                        <meta name="viewport" content="width=device-width, initial-scale=1">
                                        <style>
                                            html { opacity: 0; }
                                            html.ready { opacity: 1; }
                                            html, body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 0; overflow: hidden; width: 100%; }
                                            img { max-width: 100%; height: auto; }
                                            a { color: #2563eb; }
                                            #email-content-wrapper { display: block; overflow: hidden; }
                                            
                                            /* Smart Invert for Dark Mode */
                                            html.dark-mode {
                                                filter: invert(1) hue-rotate(180deg) brightness(1.05);
                                                background-color: #EEEEEE; /* Inverts to ~ #111111 matching the outer pane */
                                            }
                                            html.dark-mode img, 
                                            html.dark-mode video, 
                                            html.dark-mode picture,
                                            html.dark-mode svg,
                                            html.dark-mode [style*="background-image"] {
                                                filter: invert(1) hue-rotate(180deg);
                                            }
                                            html.dark-mode a {
                                                color: #3b82f6; /* Adjust link color for dark mode */
                                            }
                                        </style>
                                    </head>
                                    <body>
                                        <div id="email-content-wrapper">
                                            ${DOMPurify.sanitize(
                                    sanitizeHtml(bodyContent, {
                                        allowedTags: sanitizeHtml.defaults.allowedTags.concat([
                                            "img", "table", "tbody", "tr", "td", "th", "style", "head", "meta", "html", "body"
                                        ]),
                                        allowedAttributes: {
                                            a: ["href", "name", "target"],
                                            img: ["src", "alt", "width", "height"],
                                            td: ["colspan", "rowspan", "align"],
                                            "*": ["style"]
                                        }
                                    }),
                                    { FORBID_TAGS: ['script', 'iframe', 'object', 'embed'] }
                                )}
                                        </div>
                                        <script>
                                            const wrapper = document.getElementById('email-content-wrapper');
                                            let lastHeight = 0;
                                            
                                            // --- Smart Dark Mode Heuristics ---
                                            const applySmartInvert = () => {
                                                if (!${isDark}) return;
                                                
                                                // Function to parse rgb/rgba to check brightness
                                                const getBrightness = (colorStr) => {
                                                    const match = colorStr.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
                                                    if (!match) return 255; // default to light if parsing fails
                                                    const r = parseInt(match[1]);
                                                    const g = parseInt(match[2]);
                                                    const b = parseInt(match[3]);
                                                    // Standard luminance formula
                                                    return (r * 299 + g * 587 + b * 114) / 1000;
                                                };

                                                // Check body and wrapper computed backgrounds
                                                let bodyBg = window.getComputedStyle(document.body).backgroundColor;
                                                let wrapperBg = window.getComputedStyle(wrapper).backgroundColor;
                                                
                                                // If both are transparent/rgba(0,0,0,0), assume it's "white" by default HTML standards
                                                let isTransparent = (bg) => bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
                                                
                                                let effectiveBg = 'rgb(255, 255, 255)'; // Default HTML bg
                                                if (!isTransparent(wrapperBg)) effectiveBg = wrapperBg;
                                                else if (!isTransparent(bodyBg)) effectiveBg = bodyBg;

                                                const brightness = getBrightness(effectiveBg);
                                                
                                                // If the background is light (brightness > 128), invert it!
                                                // If it's already dark (brightness <= 128), leave it alone because it's a native dark email.
                                                if (brightness > 128) {
                                                    document.documentElement.classList.add('dark-mode');
                                                }
                                            };
                                            
                                            // Run IMMEDIATELY as the DOM parses, before images load!
                                            applySmartInvert();
                                            document.documentElement.classList.add('ready');

                                            const sendHeight = () => {
                                                if (!wrapper) return;
                                                // Only measure the strict wrapper height, ignoring the stretched iframe
                                                const height = wrapper.scrollHeight;
                                                
                                                if (height !== lastHeight) {
                                                    lastHeight = height;
                                                    window.parent.postMessage({ type: 'resize', height: height, id: '${email.id}' }, '*');
                                                }
                                            };
                                            
                                            window.addEventListener('load', sendHeight);
                                            
                                            // 1. Observe size changes strictly on wrapper, NOT document.body
                                            new ResizeObserver(sendHeight).observe(wrapper);
                                            
                                            // 2. Observe DOM mutations strictly inside wrapper
                                            new MutationObserver(sendHeight).observe(wrapper, { 
                                                childList: true, subtree: true, attributes: true 
                                            });
                                            
                                            // 3. Aggressive polling for 5 seconds
                                            let pollCount = 0;
                                            const pollInterval = setInterval(() => {
                                                sendHeight();
                                                pollCount++;
                                                if (pollCount > 50) clearInterval(pollInterval);
                                            }, 100);
                                        </script>
                                    </body>
                                    </html>
                                `}
                            />
                        )}

                        {email.attachments?.map((att, i) => (
                            <AttachmentCard key={i} attachment={att} />
                        ))}
                    </motion.div>
                </AnimatePresence>
            </div>
        </section>
    );
};

export default EmailDetail;
