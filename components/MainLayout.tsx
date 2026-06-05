"use client";

import React, { useState, useLayoutEffect, useRef, useEffect, useCallback } from 'react';
import { Email } from '@/lib/types';
import { formatEmailTime } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';

import { motion, AnimatePresence } from 'framer-motion';
import ComposeModal from '@/components/ComposeModal';
import gsap from 'gsap';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isPermissionGranted, requestPermission, onAction, registerActionTypes, sendNotification } from '@tauri-apps/plugin-notification';
import { useSync } from '@/components/SyncContext';
import LogoSpinner from '@/components/LogoSpinner';
import Sidebar from '@/components/Sidebar';
import EmailList from '@/components/EmailList';
import EmailDetail from '@/components/EmailDetail';

export default function MainLayout() {
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
    const [isComposeOpen, setIsComposeOpen] = useState(false);

    // --- New State for Folders & Stars ---
    const [currentFolder, setCurrentFolder] = useState<string>("inbox");
    const currentFolderRef = useRef<string>("inbox"); // Live reference to avoid stale closures in event listeners
    const [emails, setEmails] = useState<Email[]>([]);
    const { isSyncing, setIsSyncing, setSyncMessage, unreadCounts, setUnreadCounts, syncTriggerCount, triggerSync } = useSync();
    const [isBootstrapping, setIsBootstrapping] = useState(true);
    const [isLoadingFolder, setIsLoadingFolder] = useState(false); // Loading skeleton when switching folders
    const [syncError, setSyncError] = useState<string | null>(null);
    const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});

    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const emailListContainerRef = useRef<HTMLDivElement>(null);
    const emailsRef = useRef<Email[]>([]);

    useEffect(() => {
        emailsRef.current = emails;
    }, [emails]);

    // Keep currentFolderRef in sync so event listeners always read the latest folder
    useEffect(() => {
        currentFolderRef.current = currentFolder;
    }, [currentFolder]);

    const layoutRef = useRef<HTMLDivElement>(null);
    const hasSyncedRef = useRef(false);

    // --- Derived State ---

    const filteredEmails = emails.filter(email => {
        if (currentFolder === "starred") {
            return email.starred;
        }
        return email.folder === currentFolder;
    });

    const selectedEmail = emails.find(e => e.id === selectedEmailId);

    const fetchUnreadCounts = async () => {
        try {
            const counts = await invoke<Record<string, number>>('get_unread_counts');
            setUnreadCounts(counts);
        } catch (error) {
            console.error("Failed to fetch unread counts", error);
        }
    };

    const updateUnreadCount = (email: Email, delta: number) => {
        setUnreadCounts(prev => {
            const newCounts = { ...prev };
            const folderId = email.folder.toLowerCase();
            newCounts[folderId] = Math.max(0, (newCounts[folderId] || 0) + delta);
            if (email.starred) {
                newCounts['starred'] = Math.max(0, (newCounts['starred'] || 0) + delta);
            }
            return newCounts;
        });
    };

    // --- Global State Sync ---
    useEffect(() => {
        fetchUnreadCounts();
    }, []);

    // --- Handlers ---

    const toggleStar = async (emailId: string) => {
        const target = emails.find(e => e.id === emailId);
        if (!target) return;

        const newStarredState = !target.starred;

        // Optimistic Update
        setEmails(prev => prev.map(email =>
            email.id === emailId ? { ...email, starred: newStarredState } : email
        ));

        if (target.unread) {
            setUnreadCounts(prev => ({
                ...prev,
                starred: Math.max(0, (prev['starred'] || 0) + (newStarredState ? 1 : -1))
            }));
        }

        try {
            const folderName = target.folder === "sent" ? "sent" : "INBOX";
            await invoke('toggle_star', { uid: target.uid, shouldStar: newStarredState, folder: folderName });
            fetchUnreadCounts();
        } catch (err) {
            console.error("Failed to toggle star", err);
            if (String(err).includes("No active account")) {
                localStorage.removeItem("orion_user");
                window.location.href = "/";
                return;
            }
            // Rollback
            setEmails(prev => prev.map(email =>
                email.id === emailId ? { ...email, starred: !newStarredState } : email
            ));
        }
    };

    const toggleRead = async (emailId: string) => {
        const target = emails.find(e => e.id === emailId);
        if (!target) return;

        const newReadState = !target.unread; // if it was unread, it becomes read, i.e., should_read = true.

        // Optimistic Update
        setEmails(prev => prev.map(email =>
            email.id === emailId ? { ...email, unread: !newReadState } : email
        ));

        updateUnreadCount(target, newReadState ? -1 : 1);

        try {
            const folderName = target.folder === "sent" ? "sent" : "INBOX";
            await invoke('toggle_read', { uid: target.uid, shouldRead: newReadState, folder: folderName });
            fetchUnreadCounts();
        } catch (err) {
            console.error("Failed to toggle read", err);
            if (String(err).includes("No active account")) {
                localStorage.removeItem("orion_user");
                window.location.href = "/";
                return;
            }
            // Rollback
            setEmails(prev => prev.map(email =>
                email.id === emailId ? { ...email, unread: target.unread } : email
            ));
        }
    };

    const markAsRead = async (emailId: string) => {
        const target = emails.find(e => e.id === emailId);
        if (!target || !target.unread) return;

        // Optimistic Update
        setEmails(prev => prev.map(email =>
            email.id === emailId ? { ...email, unread: false } : email
        ));

        updateUnreadCount(target, -1);

        try {
            const folderName = target.folder === "sent" ? "sent" : "INBOX";
            await invoke('mark_as_read', { uid: target.uid, folder: folderName });
            fetchUnreadCounts();
        } catch (err) {
            console.error("Failed to mark as read", err);
            if (String(err).includes("No active account")) {
                localStorage.removeItem("orion_user");
                window.location.href = "/";
                return;
            }
            // Rollback
            setEmails(prev => prev.map(email =>
                email.id === emailId ? { ...email, unread: true } : email
            ));
        }
    };

    const deleteMessage = async (emailId: string) => {
        const target = emails.find(e => e.id === emailId);
        if (!target) return;
        
        // Optimistic Update
        setEmails(prev => prev.filter(email => email.id !== emailId));
        if (selectedEmailId === emailId) {
            setSelectedEmailId(null);
        }

        if (target.unread) {
            updateUnreadCount(target, -1);
        }

        try {
            const folderName = target.folder === "sent" ? "sent" : "INBOX";
            await invoke('delete_message', { uid: target.uid, folder: folderName });
            fetchUnreadCounts();
        } catch (err) {
            console.error("Failed to delete message", err);
            if (String(err).includes("No active account")) {
                localStorage.removeItem("orion_user");
                window.location.href = "/";
                return;
            }
            // Rollback via DB fetch since array splicing is tricky to reverse
            await fetchCache(currentFolder);
        }
    };

    const dedupeEmails = (emailArray: Email[]) => {
        const emailMap = new Map();
        for (const email of emailArray) {
            if (emailMap.has(email.id)) {
                console.warn("Duplicate email detected", email.id);
            }
            emailMap.set(email.id, email);
        }
        
        const unique = Array.from(emailMap.values());
        // Sort: primary by timestamp descending, secondary by uid descending
        return unique.sort((a, b) => {
            if (b.timestamp !== a.timestamp) {
                return b.timestamp - a.timestamp;
            }
            return b.uid - a.uid;
        });
    };

    const formatEmailFromMessage = (msg: any): Email => {
        const folder = msg.folder?.toLowerCase() === "sent" ? "sent" : "inbox";
        let senderName = msg.from.split('<')[0].trim();
        if (!senderName) {
            const emailMatch = msg.from.match(/<([^>]+)>/);
            senderName = emailMatch ? emailMatch[1].split('@')[0] : msg.from;
        }

        return {
            id: `${folder}-${msg.uid}`,
            uid: msg.uid,
            sender: senderName,
            senderEmail: msg.from,
            to: msg.to || undefined,
            subject: msg.subject || '(No Subject)',
            preview: msg.snippet?.trim() || msg.subject?.substring(0, 100) || 'No preview available',
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName)}&background=random`,
            time: formatEmailTime(msg.date * 1000),
            date: new Date(msg.date * 1000).toLocaleString(),
            timestamp: msg.date * 1000,
            unread: !msg.seen,
            folder: folder,
            tags: [],
            starred: msg.flagged,
            body: msg.snippet || '<p>Message body not fetched in this milestone.</p>',
            attachments: [],
        };
    };

    const fetchCache = async (folderToFetch = currentFolderRef.current) => {
        if (folderToFetch === "drafts" || folderToFetch === "trash") {
            setEmails([]);
            setHasMore(false);
            return false;
        }

        try {
            const cached: any[] = await invoke('get_folder_messages', { folder: folderToFetch, beforeUid: null, limit: 50 });
            if (cached && cached.length > 0) {
                const formattedEmails = cached.map(formatEmailFromMessage);
                setEmails(dedupeEmails(formattedEmails));
                setHasMore(cached.length === 50);
                fetchUnreadCounts();
                return true;
            }
            setEmails([]);
            setHasMore(false);
            fetchUnreadCounts();
            return false;
        } catch (error) {
            console.error("Failed to load cache", error);
            if (String(error).includes("No active account")) {
                localStorage.removeItem("orion_user");
                window.location.href = "/";
            }
            return false;
        }
    };

    const refreshNewEmails = async (folderToFetch = currentFolderRef.current) => {
        if (folderToFetch === "drafts" || folderToFetch === "trash") return;

        try {
            const cached: any[] = await invoke('get_folder_messages', { folder: folderToFetch, beforeUid: null, limit: 50 });
            if (!cached || cached.length === 0) return;

            const existingEmails = emailsRef.current;
            if (existingEmails.length === 0) {
                await fetchCache(folderToFetch);
                return;
            }

            const formattedEmails = cached.map(formatEmailFromMessage);

            setEmails(prev => {
                // Only merge if the current folder matches what we fetched
                // (guards against race conditions when switching folders)
                if (currentFolderRef.current !== folderToFetch && folderToFetch !== "starred") {
                    return prev;
                }
                const merged = [...formattedEmails, ...prev];
                return dedupeEmails(merged);
            });

            fetchUnreadCounts();
        } catch (error) {
            console.error("Failed to refresh new emails", error);
            if (String(error).includes("No active account")) {
                localStorage.removeItem("orion_user");
                window.location.href = "/";
            }
        }
    };

    const loadMoreEmails = async () => {
        const currentEmails = emailsRef.current;
        if (isLoadingMore || !hasMore || currentEmails.length === 0 || currentFolder === "drafts" || currentFolder === "trash") return;
        setIsLoadingMore(true);
        try {
            const lastEmail = currentEmails[currentEmails.length - 1];
            const beforeUid = lastEmail.uid;

            const nextBatch: any[] = await invoke('get_folder_messages', { folder: currentFolder, beforeUid, limit: 50 });
            if (nextBatch.length === 0) {
                setHasMore(false);
            } else {
                const formattedEmails = nextBatch.map(formatEmailFromMessage);
                setEmails(prev => {
                    const merged = [...prev, ...formattedEmails];
                    return dedupeEmails(merged);
                });
                if (nextBatch.length < 50) {
                    setHasMore(false);
                }
            }
        } catch (err) {
            console.error("Failed to load more emails", err);
            if (String(err).includes("No active account")) {
                window.location.href = "/";
            }
        } finally {
            setIsLoadingMore(false);
        }
    };

    const handleSync = (isBackground = false) => {
        // Read currentFolder from ref to avoid stale closure issues
        const folderAtSyncTime = currentFolderRef.current;
        if (isSyncing || folderAtSyncTime === "drafts" || folderAtSyncTime === "trash") return Promise.resolve();
        setIsSyncing(true);
        setSyncError(null);

        // For Starred, we just need to ensure Inbox/Sent are relatively up-to-date.
        // We will opportunistically sync Inbox if they are on Starred view.
        const syncTarget = folderAtSyncTime === "starred" ? "inbox" : folderAtSyncTime;

        // NOTE: sync_mail_folder is fire-and-forget on the backend (enqueues async sync,
        // returns 0 immediately). The real results arrive via the 'mail:updated' event.
        // We still call fetchCache after a brief delay as a safety net for cases where
        // the sync completes very quickly or the event is missed.
        return invoke('sync_mail_folder', { folder: syncTarget })
            .then(async () => {
                console.log(`Sync enqueued for: ${syncTarget}`);

                if (!isBackground) {
                    setSyncMessage("Syncing...");
                    // Clear syncing message after reasonable wait
                    setTimeout(() => setSyncMessage(null), 4000);
                }

                // Always re-fetch from the DB after enqueuing sync.
                // This catches any messages the backend may have already written.
                await fetchCache(folderAtSyncTime);
            })
            .catch((e) => {
                console.error("Failed to sync messages:", e);
                if (String(e).includes("No active account")) {
                    localStorage.removeItem("orion_user");
                    window.location.href = "/";
                    return;
                }
                if (!isBackground) {
                    setSyncError("Failed to sync messages. Please try again.");
                    setTimeout(() => setSyncError(null), 3000);
                }
            })
            .finally(() => {
                setIsSyncing(false);
            });
    };
    
    const handleForceSync = () => {
        triggerSync();
    };

    useEffect(() => {
        if (syncTriggerCount > 0) {
            handleSync(false);
        }
    }, [syncTriggerCount]);

    // Calculate total unreads and update tray
    useEffect(() => {
        const total = Object.entries(unreadCounts).reduce((acc, [key, val]) => {
            if (key === 'starred') return acc; // starred is a duplicate of unread state
            return acc + (val || 0);
        }, 0);
    }, [unreadCounts]);

    useEffect(() => {
        const interval = setInterval(() => {
            invoke('sync_mail_folder', { folder: 'inbox' }).catch(console.error);
            fetchUnreadCounts();
        }, 60000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        let unlistenSync: (() => void) | undefined;
        let unlistenCompose: (() => void) | undefined;
        let unlistenHidden: (() => void) | undefined;

        const setupTrayListeners = async () => {
            unlistenSync = await listen('tray:sync_now', () => {
                console.log("tray:sync_now event received");
                triggerSync(); // Use context trigger to avoid stale state in handleSync
            });
            
            unlistenCompose = await listen('tray:compose', () => {
                console.log("tray:compose event received");
                setIsComposeOpen(true);
            });
            
            unlistenHidden = await listen('window:hidden', async () => {
                const hintShown = localStorage.getItem("orion_tray_hint");
                if (!hintShown) {
                    try {
                        sendNotification({
                            title: 'Orion Mail is still running',
                            body: "You'll continue receiving notifications and syncing email in the background."
                        });
                        localStorage.setItem("orion_tray_hint", "true");
                    } catch (e) {
                        console.error("Failed to send tray hint notification", e);
                    }
                }
            });
        };

        setupTrayListeners();

        return () => {
            if (unlistenSync) unlistenSync();
            if (unlistenCompose) unlistenCompose();
            if (unlistenHidden) unlistenHidden();
        };
    }, []);

    const blockForInitialSync = async () => {
        // Since AuthContext (or another component) might have already triggered `sync_inbox`,
        // the Rust mutex might be locked. If the database is completely empty, 
        // we must literally wait and poll the cache until the background sync thread finishes 
        // pumping the first batch of SQLite messages to disk.
        return new Promise<void>((resolve) => {
            const pollInterval = setInterval(async () => {
                try {
                    const hasMessages = await fetchCache();
                    if (hasMessages) {
                        clearInterval(pollInterval);
                        resolve();
                    }
                } catch (err) {
                    // Ignore transient load errors
                }
            }, 500);

            // Safety timeout
            setTimeout(() => {
                clearInterval(pollInterval);
                resolve();
            }, 120000); // 2 min max wait
        });
    };

    useEffect(() => {
        const loadCache = async () => {
            const hasCache = await fetchCache();
            const wasMinimized = await invoke<boolean>('was_launched_minimized').catch(() => false);

            if (!wasMinimized) {
                setSyncMessage("✓ Background sync active");
                setTimeout(() => setSyncMessage(null), 2500);
            }

            if (!hasCache) {
                // DB is empty, sync is likely already running in the background. Block and poll.
                // If this is a fresh launch (not after login), we trigger sync ourselves.
                handleSync(false);
                await blockForInitialSync();
            }

            // Drop bootstrap loader only after emails are available
            setIsBootstrapping(false);

            if (!hasSyncedRef.current) {
                hasSyncedRef.current = true;

                // If we already had a cache, we just spun up instantly. 
                // Delay a background sync to grab new items to prevent layout jank.
                // If launched via autostart, delay 10s to let VPN/WiFi connect.
                if (hasCache) {
                    let delay = wasMinimized ? 10000 : 500;
                    setTimeout(() => {
                        handleSync(true);
                    }, delay);
                }
            }
        };

        loadCache();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!isBootstrapping) {
            setSelectedEmailId(null);
            setIsLoadingFolder(true);
            setEmails([]); // Clear stale emails immediately to prevent wrong-folder flash
            fetchCache(currentFolder).then((hasCache) => {
                setIsLoadingFolder(false);
                if (hasCache) {
                    // Debounced background sync on folder entry
                    setTimeout(() => {
                        handleSync(true);
                    }, 500);
                } else {
                    handleSync(false);
                }
            }).catch(() => {
                setIsLoadingFolder(false);
            });
        }
    }, [currentFolder, isBootstrapping]);

    const [syncingFolders, setSyncingFolders] = useState<Set<string>>(new Set());

    useEffect(() => {
        let unlistenUpdated: (() => void) | undefined;
        let unlistenStarted: (() => void) | undefined;
        let unlistenFinished: (() => void) | undefined;
        let unlistenError: (() => void) | undefined;

        const setupListener = async () => {
            unlistenUpdated = await listen<string>('mail:updated', async (event) => {
                const syncedFolder = event.payload;
                const activeFolder = currentFolderRef.current;

                const isRelevant = 
                    activeFolder === syncedFolder ||
                    (activeFolder === 'starred' && (syncedFolder === 'inbox' || syncedFolder === 'sent'));

                if (!isRelevant) return;

                if (emailsRef.current.length === 0) {
                    await fetchCache(activeFolder);
                } else {
                    await refreshNewEmails(activeFolder);
                }
            });

            unlistenStarted = await listen<string>('mail:sync_started', (event) => {
                const folder = event.payload;
                setSyncingFolders(prev => new Set(prev).add(folder));
                setSyncErrors(prev => {
                    const next = { ...prev };
                    delete next[folder];
                    return next;
                });
            });

            unlistenFinished = await listen<string>('mail:sync_finished', async (event) => {
                setSyncingFolders(prev => {
                    const next = new Set(prev);
                    next.delete(event.payload);
                    return next;
                });
                
                if (event.payload === currentFolderRef.current && emailsRef.current.length === 0) {
                    await fetchCache(event.payload);
                }
            });
            
            unlistenError = await listen<any>('mail:sync_error', (event) => {
                setSyncErrors(prev => ({
                    ...prev,
                    [event.payload.folder]: event.payload.error
                }));
            });
        };

        setupListener();

        return () => {
            if (unlistenUpdated) unlistenUpdated();
            if (unlistenStarted) unlistenStarted();
            if (unlistenFinished) unlistenFinished();
            if (unlistenError) unlistenError();
        };
    }, []);

    // --- Notification Permissions & Logic ---
    useEffect(() => {
        const setupNotifications = async () => {
            try {
                let permissionGranted = await isPermissionGranted();
                if (!permissionGranted) {
                    const permission = await requestPermission();
                    permissionGranted = permission === 'granted';
                }

                if (permissionGranted) {
                    console.log("Notification permission granted");

                    try {
                        await registerActionTypes([
                            {
                                id: 'new_email',
                                actions: [
                                    { id: 'open', title: 'Open' },
                                    { id: 'mark_read', title: 'Mark as Read' }
                                ]
                            },
                            {
                                id: 'summary_email',
                                actions: [
                                    { id: 'open', title: 'Open Inbox' }
                                ]
                            }
                        ]);
                    } catch (e) {
                        console.warn("Failed to register action types. May not be supported on this OS.", e);
                    }

                    // Listen for notification clicks
                    try {
                        const unlisten = await onAction((result: any) => {
                            console.log('Notification action:', result);

                            // Handle 'mark_read' action without focusing the window
                            if (result.actionId === 'mark_read') {
                                const uid = result.notification?.extra?.uid;
                                if (uid) {
                                    const emailId = `inbox-${uid}`; // Assuming inbox since notifications are for inbox
                                    markAsRead(emailId).catch(console.error);
                                }
                                return;
                            }

                            // Handle 'open' or default click
                            invoke('show_main_window').catch(console.error);
                            setCurrentFolder("inbox"); // Force navigation to inbox

                            if (result.notification?.actionTypeId === 'new_email') {
                                const uid = result.notification?.extra?.uid;
                                if (uid) {
                                    setSelectedEmailId(`inbox-${uid}`);
                                }
                            } else if (result.notification?.actionTypeId === 'summary_email') {
                                // Just clear selection so the list is shown
                                setSelectedEmailId(null);
                            } else {
                                // Fallback for default notifications
                                const uid = result.notification?.extra?.uid;
                                if (uid) {
                                    setSelectedEmailId(`inbox-${uid}`);
                                }
                            }
                        });
                        return unlisten;
                    } catch (e: any) {
                        if (e?.includes?.("registerListener not allowed") || e?.includes?.("not found")) {
                            console.info("Notification clicks are not currently supported by Tauri on this desktop OS.");
                        } else {
                            console.error("Failed to setup notification action listener:", e);
                        }
                    }
                }
            } catch (error) {
                console.error("Failed to setup notifications:", error);
            }
        };

        const listenerPromise = setupNotifications();
        return () => {
            listenerPromise.then(listener => {
                if (listener && typeof listener.unregister === 'function') {
                    listener.unregister();
                }
            });
        };
    }, []);

    useLayoutEffect(() => {
        if (isBootstrapping) return;

        const ctx = gsap.context(() => {
            const tl = gsap.timeline();

            tl.from('.sidebar-anim', {
                x: -30,
                opacity: 0,
                duration: 0.6,
                ease: "power2.out"
            });

            tl.from('.list-anim', {
                opacity: 0,
                duration: 0.8,
                ease: "power1.inOut"
            }, "-=0.4");

            tl.from('.detail-anim', {
                x: 30,
                opacity: 0,
                duration: 0.6,
                ease: "power2.out"
            }, "-=0.6");
        }, layoutRef);

        return () => ctx.revert();
    }, [isBootstrapping]);

    if (isBootstrapping) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-[#F8F9FA]/80 dark:bg-[#09090b]/80 backdrop-blur-xl transition-colors">

                <LogoSpinner message="Syncing Inbox..." />
            </div>
        );
    }

    return (
        /* Main Dashboard Container - Full Window Fill */
        <div ref={layoutRef} className="flex h-full w-full overflow-hidden bg-white/40 relative">
            {/* Sync Error Toast */}
            <AnimatePresence>
                {syncError && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium backdrop-blur-md"
                    >
                        {syncError}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Column 1: Sidebar */}
            <Sidebar
                className="sidebar-anim w-64 flex flex-col shrink-0"
                onCompose={() => setIsComposeOpen(true)}
                currentFolder={currentFolder}
                onFolderSelect={setCurrentFolder}
                unreadCounts={unreadCounts}
            />

            {/* Column 2: Message List */}
            <div className="list-anim w-[380px] flex flex-col shrink-0 border-r border-black/5 dark:border-white/5">
                {/* Sync Error Banner */}
                <AnimatePresence>
                    {Object.entries(syncErrors).length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="bg-red-500/10 border-b border-red-500/20 text-red-600 dark:text-red-400 px-4 py-2.5 flex items-center justify-between z-10"
                        >
                            <div className="flex items-center gap-2 overflow-hidden">
                                <AlertCircle className="w-4 h-4 shrink-0" />
                                <span className="text-xs font-medium truncate">
                                    Sync failed. Check connection.
                                </span>
                            </div>
                            <button
                                onClick={handleForceSync}
                                className="text-xs font-bold hover:text-red-700 dark:hover:text-red-300 ml-4 shrink-0 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
                            >
                                RETRY
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                <EmailList
                    className="flex-1 overflow-hidden"
                    emails={filteredEmails}
                    selectedEmailId={selectedEmailId}
                onSelectEmail={(id) => setSelectedEmailId(id)}
                onToggleStar={toggleStar}
                onToggleRead={toggleRead}
                onDeleteMessage={deleteMessage}
                onSync={handleSync}
                isSyncing={isSyncing || isLoadingFolder || syncingFolders.has(currentFolder)}
                onLoadMore={loadMoreEmails}
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
                listRef={emailListContainerRef}
                currentFolder={currentFolder}
            />
            </div>

            {/* Column 3: Reading Pane */}
            <EmailDetail
                className="detail-anim flex-1 flex flex-col"
                email={selectedEmail}
                onToggleStar={toggleStar}
                onDeleteMessage={deleteMessage}
                onMarkAsRead={markAsRead}
            />

            {/* Compose Modal Overlay */}
            <AnimatePresence>
                {isComposeOpen && (
                    <ComposeModal onClose={() => setIsComposeOpen(false)} />
                )}
            </AnimatePresence>
        </div>
    );
}
