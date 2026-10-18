"use client";

import React from 'react';
import { AlertOctagon, File, Clock, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Email } from '@/lib/types';
import DOMPurify from 'isomorphic-dompurify';
import sanitizeHtml from 'sanitize-html';
import { useTheme } from 'next-themes';
import { DetailToolbar } from './inbox/DetailToolbar';
import { MessageHeader, AttachmentCard } from './inbox/MessageHeader';
import { useEmailBody } from '@/hooks/useEmailBody';
import OrbitLoader from './inbox/OrbitLoader';
import { SmartActionsEngine, SmartActionKind } from '@/lib/smart-actions';
import { SmartActionCard } from './inbox/SmartActionCard';
import { useAuth } from './AuthContext';
import { useAppPreferences } from '@/components/AppPreferencesContext';

// --- Types ---

interface EmailDetailProps {
    className?: string;
    email?: Email | null;
    onToggleStar?: (emailId: string) => void;
    onDeleteMessage?: (emailId: string) => void;
    onMarkAsRead?: (emailId: string) => void;
    onToggleRead?: (emailId: string) => void;
    onBack?: () => void;
}

// --- Main Component ---

const EmailDetail: React.FC<EmailDetailProps> = ({ className, email, onToggleStar, onDeleteMessage, onMarkAsRead, onToggleRead, onBack }) => {
    const scrollRef = React.useRef<HTMLDivElement>(null);
    const emailIframeRef = React.useRef<HTMLIFrameElement>(null);
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const { preferences } = useAppPreferences();
    const { user } = useAuth();
    const remoteMessageKey = `${user?.id}:${email?.id}`;
    const [allowedRemoteMessage, setAllowedRemoteMessage] = React.useState<string | null>(null);
    const remoteAllowed = !preferences.blockRemoteImages || allowedRemoteMessage === remoteMessageKey;

    const { bodyContent, attachments, extractedData, isLoadingBody, iframeHeight, error, retry } = useEmailBody(
        email?.id,
        email?.uid,
        email?.unread,
        email?.folder,
        emailIframeRef,
        onMarkAsRead
    );

    React.useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [email?.id, user?.id]);

    const smartActions = React.useMemo(() => {
        if (!preferences.smartActionsGlobal) return [];
        if (!extractedData || isLoadingBody) return [];
        
        const actions = SmartActionsEngine.detect({
            extractedData,
            receivedAt: email?.timestamp || 0,
            subject: email?.subject || '',
            sender: email?.sender || ''
        });

        return actions.filter(action => {
            if (action.kind === SmartActionKind.OTP && !preferences.smartActionsOtp) return false;
            if (action.kind === SmartActionKind.MEETING && !preferences.smartActionsMeetings) return false;
            
            const commerceKinds = [
                SmartActionKind.PURCHASE, SmartActionKind.ORDER, SmartActionKind.INVOICE, 
                SmartActionKind.REFUND, SmartActionKind.SUBSCRIPTION, SmartActionKind.TRANSACTION, 
                SmartActionKind.DELIVERY, SmartActionKind.PAYMENT
            ];
            if (commerceKinds.includes(action.kind) && !preferences.smartActionsCommerce) return false;
            
            if (action.kind === SmartActionKind.TRAVEL && !preferences.smartActionsTravel) return false;
            
            return true;
        });
    }, [extractedData, isLoadingBody, email?.timestamp, email?.subject, email?.sender, preferences]);

    if (!email) {
        return (
            <section className={cn(
                "mail-reader-surface flex flex-col h-full items-center justify-center text-muted-foreground gap-4 p-8",
                className
            )}>
                <div className="w-16 h-16 rounded-2xl bg-black/5 dark:bg-white/10 flex items-center justify-center">
                    <File className="w-8 h-8 opacity-50" />
                </div>
                <div className="text-center">
                    <h3 className="font-semibold text-foreground text-lg">A little space to focus</h3>
                    <p className="text-sm opacity-70">Choose a message to start reading.</p>
                </div>
            </section>
        );
    }

    return (
        <section
            data-context-menu="message"
            className={cn(
                "mail-reader-surface flex flex-col h-full",
                className
            )}
        >
            <DetailToolbar
                isStarred={email?.starred}
                isUnread={email?.unread}
                onBack={onBack}
                onToggleRead={onToggleRead ? () => onToggleRead(email.id) : undefined}
                onToggleStar={() => email && onToggleStar?.(email.id)}
                onDelete={() => email && onDeleteMessage?.(email.id)}
            />

            {/* Content Scroll Area */}
            <div ref={scrollRef} className="mail-reader-scroll min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                    <div key={remoteMessageKey} className="mail-reading-sheet">
                        <MessageHeader email={email} />

                        {smartActions.map((action) => (
                            <SmartActionCard key={action.id} action={action} />
                        ))}

                        {!isLoadingBody && !error && preferences.blockRemoteImages && <div className="mail-privacy-bar"><span className="flex min-w-0 items-center gap-2 text-muted-foreground"><ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />{remoteAllowed ? 'Remote content allowed' : 'Remote content blocked'}</span><button type="button" className="shrink-0 rounded px-1 py-0.5 font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setAllowedRemoteMessage(remoteAllowed ? null : remoteMessageKey)}>{remoteAllowed ? 'Block again' : 'Load images'}</button></div>}
                        {error ? (() => {
                            const isTimeout = error.includes("Timeout");
                            const Icon = isTimeout ? Clock : AlertOctagon;
                            return (
                                <div className={cn("flex flex-col h-[40vh] items-center justify-center border rounded-2xl mx-auto my-8 max-w-2xl", isTimeout ? "border-orange-500/20 bg-orange-500/5" : "border-red-500/20 bg-red-500/5")}>
                                    <Icon className={cn("w-10 h-10 mb-4 opacity-80", isTimeout ? "text-orange-500" : "text-red-500")} />
                                    <h3 className={cn("text-lg font-semibold mb-2", isTimeout ? "text-orange-600 dark:text-orange-400" : "text-red-600 dark:text-red-400")}>
                                        {isTimeout ? "Connection Timeout" : "Message Body Unavailable"}
                                    </h3>
                                    <p className={cn("text-sm mb-6 text-center px-8 line-clamp-3", isTimeout ? "text-orange-600/70 dark:text-orange-400/70" : "text-red-600/70 dark:text-red-400/70")} title={error}>
                                        {isTimeout ? "The server took too long to fetch the email content. This may be due to a slow network or large email size." : error}
                                    </p>
                                    <button onClick={retry} className={cn("px-6 py-2 rounded-lg font-medium transition-colors", isTimeout ? "bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400" : "bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400")}>
                                        Try Again
                                    </button>
                                </div>
                            );
                        })() : isLoadingBody ? (
                            <div className="flex min-h-60 flex-col items-center justify-center py-10">
                                <OrbitLoader
                                    message="Loading message…"
                                    size="md"
                                />
                            </div>
                        ) : (
                            <iframe
                                ref={emailIframeRef}
                                title="Email Content"
                                className="w-full border-0 email-content-iframe bg-white dark:bg-[#111111]"
                                sandbox="allow-scripts"
                                scrolling="no"
                                style={{ height: `${iframeHeight}px`, overflow: 'hidden' }}
                                srcDoc={`
                                <!DOCTYPE html>
                                <html>
                                <head>
                                    <meta charset="utf-8">
                                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' ${remoteAllowed ? 'https: http:' : ''}; img-src data: ${remoteAllowed ? 'https: http:' : ''}; font-src data: ${remoteAllowed ? 'https: http:' : ''}; base-uri 'none'; form-action 'none';">
                                    <meta name="referrer" content="no-referrer">
                                    <meta name="viewport" content="width=device-width, initial-scale=1">
                                    <style>
                                        html { opacity: 0; }
                                        html.ready { opacity: 1; }
                                        html, body { font-family: system-ui, -apple-system, sans-serif; font-size: ${preferences.readingFontSize}px; margin: 0; padding: 0; overflow: hidden; width: 100%; }
                                        img { max-width: 100% !important; height: auto; }
                                        table { max-width: 100% !important; }
                                        body { overflow-wrap: anywhere; }
                                        pre { white-space: pre-wrap; overflow-wrap: anywhere; }
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

                                        // 4. Intercept link clicks
                                        document.addEventListener('click', function(e) {
                                            const target = e.target;
                                            const a = target && target.closest ? target.closest('a') : null;
                                            if (a && a.href) {
                                                e.preventDefault();
                                                window.parent.postMessage({ type: 'open_url', url: a.href, id: '${email.id}' }, '*');
                                            }
                                        });
                                    </script>
                                </body>
                                </html>
                            `}
                            />
                        )}

                        {attachments.length > 0 && (
                            <div className="mt-8 border-t border-black/[0.06] pt-5 dark:border-white/[0.07]">
                                <h2 className="mb-3 text-xs font-medium text-muted-foreground">Attachments <span className="ml-1 tabular-nums">{attachments.length}</span></h2>
                                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3">
                                    {attachments.map((att, i) => (
                                        <AttachmentCard
                                            key={att.partId || i}
                                            uid={email.uid}
                                            folder={email.folder}
                                            attachment={att}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
            </div>
        </section>
    );
};

export default EmailDetail;
