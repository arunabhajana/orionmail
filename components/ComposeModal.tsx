"use client";

import React, { useState, useRef, useEffect, useCallback, useId, useImperativeHandle } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Minus,
  Square,
  Pencil,
  Paperclip,
  Trash2,
  Send,
  UserPlus,
  Link as LinkIcon,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { useRecipientAutocomplete } from "@/hooks/useRecipientAutocomplete";
import RichTextEditor, {
  RichTextEditorValue,
  type LinkInsertContext,
} from "@/components/compose/RichTextEditor";
import { emailSafeCleanup, wrapEmailHtml } from "@/lib/email-safe-cleanup";
import type { Editor } from "@tiptap/core";
import DOMPurify from "isomorphic-dompurify";
import { useAppPreferences } from "./AppPreferencesContext";
import { parseAddressList, plainTextHtml } from "@/lib/app-preferences";
import { ComposeToolbar } from "./compose/ComposeToolbar";
import { useAuth } from "./AuthContext";
import { confirm } from "@tauri-apps/plugin-dialog";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

import { PendingSentMessage } from "@/hooks/usePendingSentMessages";

export interface ComposeHandle { restore: () => void; }

interface ComposeModalProps {
  windowRef?: React.Ref<ComposeHandle>;
  onClose: () => void;
  onSendStart?: (pending: PendingSentMessage) => void;
  onSendSuccess?: (id: string, messageId: string) => void;
}

export interface AttachmentFile {
  id: string;
  handle: string;
  name: string;
  size: number;
  mimeType: string;
  addedAt: number;
}

// --------------------------------------------------------------------------
// URL helpers (used in link dialog confirm handler)
// --------------------------------------------------------------------------

function isSafeUrl(url: string): boolean {
  const n = url.trim().toLowerCase();
  return (
    !n.startsWith("javascript:") &&
    !n.startsWith("vbscript:") &&
    !n.startsWith("data:")
  );
}

function normalizeUrl(url: string): string {
  const t = url.trim();
  if (!t.startsWith("http://") && !t.startsWith("https://") && !t.startsWith("mailto:")) {
    return `https://${t}`;
  }
  return t;
}

// --------------------------------------------------------------------------
// LinkDialog — replaces window.prompt for inserting/editing links
// --------------------------------------------------------------------------

interface LinkDialogProps {
  open: boolean;
  initialUrl: string;
  isEditing: boolean;
  onConfirm: (url: string) => void;
  onCancel: () => void;
}

function LinkDialog({ open, initialUrl, isEditing, onConfirm, onCancel }: LinkDialogProps) {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // Short delay so the modal animation completes before focusing
      const t = setTimeout(() => inputRef.current?.select(), 80);
      return () => clearTimeout(t);
    }
  }, [open, initialUrl]);

  const handleConfirm = () => {
    if (url.trim() === "") {
      // Empty = remove link (only valid when editing)
      onConfirm("");
      return;
    }
    const normalized = normalizeUrl(url);
    if (!isSafeUrl(normalized)) {
      setError("Only http://, https://, and mailto: links are allowed.");
      return;
    }
    onConfirm(normalized);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleConfirm();
    if (e.key === "Escape") onCancel();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 z-[300] flex items-center justify-center"
        >
          {/* Soft backdrop */}
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-[2px] rounded-xl"
            onClick={onCancel}
          />

          {/* Dialog panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 6 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="relative z-10 w-72 bg-white/85 dark:bg-[#18181b]/92 backdrop-blur-2xl rounded-xl border border-white/40 dark:border-white/10 shadow-2xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <LinkIcon className="w-3.5 h-3.5 text-primary" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-foreground dark:text-white leading-none">
                  {isEditing ? "Edit Link" : "Insert Link"}
                </p>
                <p className="text-[10px] text-muted-foreground dark:text-white/50 mt-0.5">
                  {isEditing ? "Update or remove the link" : "Paste or type a URL"}
                </p>
              </div>
            </div>

            {/* URL input */}
            <div className="mb-3">
              <input
                ref={inputRef}
                type="url"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(""); }}
                onKeyDown={handleKeyDown}
                placeholder="https://example.com"
                spellCheck={false}
                className={cn(
                  "w-full text-sm bg-black/5 dark:bg-white/5",
                  "border rounded-lg px-3 py-2 outline-none",
                  "text-foreground dark:text-white",
                  "placeholder:text-muted-foreground/40 dark:placeholder:text-white/25",
                  "transition-all duration-150",
                  error
                    ? "border-red-400/60 focus:ring-2 focus:ring-red-400/30"
                    : "border-black/10 dark:border-white/10 focus:ring-2 focus:ring-primary/35"
                )}
              />
              {error && (
                <p className="text-[10px] text-red-500 mt-1 px-1">{error}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              {isEditing && (
                <button
                  type="button"
                  onClick={() => onConfirm("")}
                  className="text-[11px] text-red-500/80 hover:text-red-500 transition-colors font-medium"
                >
                  Remove link
                </button>
              )}
              <div className={cn("flex items-center gap-2", !isEditing && "ml-auto")}>
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-3 py-1.5 text-[11px] font-medium rounded-lg text-muted-foreground dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/8 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-primary hover:bg-primary/90 text-white transition-colors shadow-sm shadow-primary/20"
                >
                  {isEditing ? "Update" : "Insert"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}



// --------------------------------------------------------------------------
// ComposeModal
// --------------------------------------------------------------------------

export type ComposeWindowState = "normal" | "maximized" | "minimized" | "hidden";
export type ComposeStatus = "draft" | "sending" | "sent" | "failed";

export default function ComposeModal({ onClose, onSendStart, onSendSuccess, windowRef }: ComposeModalProps) {
  const { preferences } = useAppPreferences();
  const { user } = useAuth();
  const titleId = useId();
  const contactsId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const [cc, setCc] = useState(preferences.defaultCc);
  const [bcc, setBcc] = useState(preferences.defaultBcc);
  const [showCopies, setShowCopies] = useState(Boolean(preferences.defaultCc || preferences.defaultBcc));
  const sendGuard = useRef(false);
  const [subject, setSubject] = useState("");
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  const isProcessingAttachmentsRef = useRef(false);

  const [isAttaching, setIsAttaching] = useState(false);

  const [composeWindowState, setComposeWindowState] = useState<ComposeWindowState>("normal");
  useImperativeHandle(windowRef, () => ({ restore: () => setComposeWindowState("normal") }), []);
  const windowStateRef = useRef<ComposeWindowState>("normal");
  useEffect(() => {
    windowStateRef.current = composeWindowState;
  }, [composeWindowState]);

  const [composeStatus, setComposeStatus] = useState<ComposeStatus>("draft");


  const [toast, setToast] = useState<{ message: string; id: number } | null>(null);
  const showToast = useCallback((message: string) => {
    const id = Date.now();
    setToast({ message, id });
    setTimeout(() => {
      setToast(prev => (prev?.id === id ? null : prev));
    }, 4000);
  }, []);

  // Rich text editor state
  const [editorValue, setEditorValue] = useState<RichTextEditorValue>({
    html: "",
    plainText: "",
    json: { type: "doc", content: [] },
    characterCount: 0,
    isEmpty: true,
  });
  const editorRef = useRef<Editor | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  // Link dialog state
  const [linkDialog, setLinkDialog] = useState<{
    open: boolean;
    initialUrl: string;
    isEditing: boolean;
    from: number;
    to: number;
  } | null>(null);

  const {
    recipients,
    inputValue,
    isOpen,
    selectedIndex,
    filteredContacts,
    setSelectedIndex,
    handleInputChange,
    handleKeyDown,
    removeRecipient,
    toggleOpen,
    addRecipient,
    setInputValue,
  } = useRecipientAutocomplete();

  const validAddress = (value: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim());
  const invalidRecipient = recipients.some(value => !validAddress(value));
  const pendingRecipient = Boolean(inputValue.trim());
  let copiesInvalid = false;
  try { parseAddressList(cc); parseAddressList(bcc); } catch { copiesInvalid = true; }
  const commitRecipient = () => {
    if (!inputValue.trim() || !validAddress(inputValue)) return;
    addRecipient(inputValue.trim());
    setInputValue('');
  };

  const optionsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (isOpen && optionsRef.current[selectedIndex]) {
      optionsRef.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, isOpen]);

  // --------------------------------------------------------------------------
  // Block browser keybinds that interfere with compose (Ctrl+J = downloads, etc.)
  // --------------------------------------------------------------------------
  useEffect(() => {
    const blockBrowserShortcuts = (e: KeyboardEvent) => {
      if (!["normal", "maximized"].includes(windowStateRef.current) || !dialogRef.current?.contains(e.target as Node)) return;
      if (e.ctrlKey || e.metaKey) {
        // Block browser/Tauri shortcuts that conflict with compose workflow
        const blocked = new Set(["j", "f", "p", "g", "h", "l", "d", "e", "n", "r", "w", "s"]);
        if (blocked.has(e.key.toLowerCase())) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    // capture: true intercepts before the browser handles it
    document.addEventListener("keydown", blockBrowserShortcuts, { capture: true });
    return () => document.removeEventListener("keydown", blockBrowserShortcuts, { capture: true });
  }, []);



  // --------------------------------------------------------------------------
  // Autofocus: Subject → Editor on Enter
  // --------------------------------------------------------------------------
  const handleSubjectKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        editorRef.current?.commands.focus();
      }
    },
    []
  );

  // --------------------------------------------------------------------------
  // Send handler
  // --------------------------------------------------------------------------
  const handleSend = async () => {
    if (sendGuard.current || composeStatus === 'sending' || composeStatus === 'sent') return;
    if (invalidRecipient || pendingRecipient || copiesInvalid) { showToast("Check the recipient addresses before sending."); return; }
    if (recipients.length === 0) {
      showToast("Please add at least one recipient.");
      return;
    }
    if (editorValue.isEmpty || editorValue.plainText.trim().length === 0) {
      showToast("Please write a message before sending.");
      return;
    }

    let ccAddresses: string[], bccAddresses: string[];
    sendGuard.current = true;
    try {
      ccAddresses = parseAddressList(cc);
      bccAddresses = parseAddressList(bcc);
      if (preferences.confirmEmptySubject && !subject.trim() && !await confirm("Send this message without a subject?", { title: "No subject", okLabel: "Send anyway", cancelLabel: "Keep editing" })) { sendGuard.current = false; return; }
      if (preferences.attachmentReminder && attachments.length === 0 && /\b(attach(?:ed|ment|ments)?|enclosed)\b/i.test(editorValue.plainText) && !await confirm("You mentioned an attachment, but no files are attached. Send anyway?", { title: "Missing attachment?", okLabel: "Send anyway", cancelLabel: "Keep editing" })) { sendGuard.current = false; return; }
    } catch (error) { showToast(error instanceof Error ? error.message : "Could not confirm sending."); sendGuard.current = false; return; }
    setComposeStatus("sending");
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    onSendStart?.({
      id: tempId,
      subject: subject || '(No Subject)',
      recipients: recipients,
      createdAt: Date.now(),
      status: 'sending'
    });

    try {
      // Cleanup pipeline: strip TipTap attrs → DOMPurify → wrap
      const cleaned = emailSafeCleanup(editorValue.html);
      const sanitized = DOMPurify.sanitize(cleaned);
      const font = preferences.composeFont === 'serif' ? 'Georgia, serif' : preferences.composeFont === 'monospace' ? 'Courier New, monospace' : 'Arial, sans-serif';
      const htmlBody = wrapEmailHtml(`<div style="font-family:${font}">${sanitized}</div>`);
      const plainBody = editorValue.plainText;

      const messageId: string = await invoke("send_message", {
        to: recipients,
        cc: ccAddresses,
        bcc: bccAddresses,
        replyTo: null,
        subject,
        plainBody,
        htmlBody,
        attachments: attachments.map(a => a.handle),
      });

      setComposeStatus("sent");
      onSendSuccess?.(tempId, messageId);

      setTimeout(() => {
        if (windowStateRef.current !== "hidden") {
          onClose();
        }
      }, 2000);
    } catch (error) {
      console.error("Failed to send message:", error);
      sendGuard.current = false;
      setComposeStatus("failed");
      setComposeWindowState(prev => prev === "hidden" ? "minimized" : prev);
    }
  };

  // --------------------------------------------------------------------------
  // Attachment handlers
  // --------------------------------------------------------------------------
  const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024; // 18MB raw (~24MB base64)
  const MAX_ATTACHMENTS = 25;

  const processAttachments = async (selected: Array<{ handle: string; name: string; size: number; mime_type: string }>) => {
    if (isProcessingAttachmentsRef.current) {
      await invoke("release_attachment_handles", { handles: selected.map(file => file.handle) }).catch(() => {});
      return;
    }
    isProcessingAttachmentsRef.current = true;

    try {
      const currentAttachments = attachmentsRef.current;

      if (currentAttachments.length + selected.length > MAX_ATTACHMENTS) {
        showToast(`You can only attach up to ${MAX_ATTACHMENTS} files.`);
        await invoke("release_attachment_handles", { handles: selected.map(file => file.handle) }).catch(() => {});
        return;
      }

      setIsAttaching(true);

      const newAttachments = selected.filter(file => !currentAttachments.some(a => a.handle === file.handle));
      if (newAttachments.length === 0) {
        await invoke("release_attachment_handles", { handles: selected.map(file => file.handle) }).catch(() => {});
        setIsAttaching(false);
        return;
      }

      const totalSize = currentAttachments.reduce((sum, a) => sum + a.size, 0) +
        newAttachments.reduce((sum, a) => sum + a.size, 0);

      if (totalSize > MAX_ATTACHMENT_BYTES) {
        showToast("Files exceed the 18MB size limit. Please remove some attachments.");
        await invoke("release_attachment_handles", { handles: selected.map(file => file.handle) }).catch(() => {});
        setIsAttaching(false);
        return;
      }

      const attachmentsWithId: AttachmentFile[] = newAttachments.map(a => ({
        ...a,
        mimeType: a.mime_type,
        id: Math.random().toString(36).substring(7),
        addedAt: Date.now()
      }));

      setAttachments(prev => [...prev, ...attachmentsWithId]);
      setIsAttaching(false);
    } catch (error) {
      console.error("Failed to attach files:", error);
      showToast("Could not attach files. They might be moved or deleted.");
      setIsAttaching(false);
    } finally {
      isProcessingAttachmentsRef.current = false;
    }
  };

  const handleAttachFiles = async () => {
    try {
      const selected = await invoke<Array<{ handle: string; name: string; size: number; mime_type: string }>>("pick_attachments");
      if (selected.length > 0) await processAttachments(selected);
    } catch (error) {
      console.error("Failed to select attachments:", error);
      showToast(String(error));
    }
  };

  const removeAttachment = (id: string) => {
    const attachment = attachmentsRef.current.find(file => file.id === id);
    if (attachment) {
      invoke("release_attachment_handles", { handles: [attachment.handle] }).catch(() => {});
    }
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  useEffect(() => () => {
    const handles = attachmentsRef.current.map(file => file.handle);
    if (handles.length > 0) invoke("release_attachment_handles", { handles }).catch(() => {});
  }, []);

  // --------------------------------------------------------------------------
  // Toolbar: derive active states from editor
  // --------------------------------------------------------------------------

  // Force re-render when editor selection/marks change so toolbar stays in sync.
  // We subscribe via onUpdate + onSelectionUpdate in the editor (handled by
  // TipTap itself — the EditorContent re-renders the parent only if we track
  // something. We use a counter to trigger it).
  const [, setTick] = useState(0);

  const handleEditorReady = useCallback((e: Editor) => {
    editorRef.current = e;
    if (preferences.signature.trim() && e.isEmpty) e.commands.setContent(`<p></p><p>—<br>${plainTextHtml(preferences.signature)}</p>`);
    setTick((t) => t + 1);

    // Subscribe to selection updates so toolbar stays live
    e.on("selectionUpdate", () => setTick((t) => t + 1));
    e.on("transaction", () => setTick((t) => t + 1));
  }, [preferences.signature]);

  const isSending = composeStatus === 'sending';
  const editingDisabled = isSending || composeStatus === 'sent';
  const isSendDisabled = editingDisabled || isAttaching || recipients.length === 0 || editorValue.isEmpty || invalidRecipient || pendingRecipient || copiesInvalid;
  const sendDisabledReason = isSending ? 'Sending message…' : composeStatus === 'sent' ? 'Message sent' : isAttaching ? 'Preparing attachments…' : invalidRecipient || copiesInvalid ? 'Check the recipient addresses' : pendingRecipient ? 'Press Enter to add the recipient' : recipients.length === 0 ? 'Add a recipient to get started' : editorValue.isEmpty ? 'Write a message before sending' : '';
  const requestClose = useCallback(async () => {
    if (closingRef.current || sendGuard.current && composeStatus !== 'sent') {
      if (composeStatus === 'sending') setComposeWindowState('minimized');
      return;
    }
    closingRef.current = true;
    try {
      const bodyChanged = !editorValue.isEmpty && editorValue.plainText.replace(/\s/g, "") !== (`—${preferences.signature}`).replace(/\s/g, "");
      const hasDraft = Boolean(subject.trim() || recipients.length || inputValue.trim() || cc !== preferences.defaultCc || bcc !== preferences.defaultBcc || attachments.length || bodyChanged);
      if (composeStatus !== 'sent' && hasDraft && !await confirm('This message has not been saved. Discard it?', { title: 'Discard message?', okLabel: 'Discard', cancelLabel: 'Keep editing', kind: 'warning' })) return;
      onClose();
    } catch { showToast('Could not close the message. Please try again.'); }
    finally { closingRef.current = false; }
  }, [composeStatus, subject, recipients.length, inputValue, cc, bcc, preferences.defaultCc, preferences.defaultBcc, attachments.length, editorValue.isEmpty, editorValue.plainText, preferences.signature, onClose, showToast]);

  // --------------------------------------------------------------------------
  // Character count formatting
  // --------------------------------------------------------------------------
  const formatCharCount = (count: number): string => {
    return count.toLocaleString() + (count === 1 ? " character" : " characters");
  };

  // --------------------------------------------------------------------------
  // Link dialog: open from Ctrl+K in editor OR toolbar button
  // --------------------------------------------------------------------------
  const openLinkDialog = useCallback((ctx?: LinkInsertContext) => {
    const e = editorRef.current;
    if (!e) return;

    // If no context provided (toolbar button click), read current selection
    const { from, to } = ctx ?? e.state.selection;
    const hasSelection = ctx ? ctx.hasSelection : from !== to;
    const existingHref = ctx?.existingHref ?? (e.getAttributes("link").href as string | undefined);

    if (!hasSelection && !existingHref) return;

    setLinkDialog({
      open: true,
      initialUrl: existingHref ?? "https://",
      isEditing: !!existingHref,
      from,
      to,
    });
  }, []);

  const handleLinkConfirm = useCallback((url: string) => {
    const e = editorRef.current;
    if (!e || !linkDialog) {
      setLinkDialog(null);
      return;
    }

    const { from, to } = linkDialog;

    if (url.trim() === "") {
      // Remove link
      e.chain()
        .focus()
        .setTextSelection({ from, to })
        .extendMarkRange("link")
        .unsetLink()
        .run();
    } else {
      e.chain()
        .focus()
        .setTextSelection({ from, to })
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    }
    setLinkDialog(null);
  }, [linkDialog]);

  const handleLinkCancel = useCallback(() => {
    setLinkDialog(null);
    // Restore editor focus without resetting selection
    editorRef.current?.commands.focus();
  }, []);



  // --------------------------------------------------------------------------
  // Keyboard Shortcuts
  // --------------------------------------------------------------------------
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !linkDialog && ["normal", "maximized"].includes(windowStateRef.current)) {
        setComposeWindowState("minimized");
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [linkDialog]);

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------
  const isMinimized = composeWindowState === "minimized";
  const isMaximized = composeWindowState === "maximized";
  const isHidden = composeWindowState === "hidden";

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 pointer-events-none transition-opacity duration-300",
        isHidden ? "opacity-0 -z-10" : "opacity-100"
      )}
    >
      {/* Backdrop */}
      {!isMinimized && !isHidden && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-900/10 backdrop-blur-sm pointer-events-auto"
        />
      )}

      {/* Modal Window */}
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal={!isMinimized && !isHidden}
        aria-labelledby={titleId}
        onKeyDown={event => {
          if (isMinimized || isHidden) return;
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!isSendDisabled) void handleSend(); }
          if (event.key === 'Tab' && !linkDialog) {
            const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [contenteditable="true"], [tabindex="0"]') || []).filter(element => element.offsetParent !== null && !element.closest('[inert]'));
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}
        initial={{
          opacity: 0,
          scale: 0.95,
          top: "calc(50% + 0px)",
          left: "calc(50% + 0px)",
          x: "-50%",
          y: "-48%",
          width: "calc(100% + -32px)",
          maxWidth: "calc(0% + 720px)",
          height: "calc(100% + -32px)",
          maxHeight: "calc(0% + 680px)",
          borderRadius: "16px"
        }}
        animate={{
          opacity: isHidden ? 0 : 1,
          scale: 1,
          top: isMaximized ? "calc(0% + 30px)" : isMinimized ? "calc(100% + -24px)" : "calc(50% + 0px)",
          left: isMaximized ? "calc(0% + 0px)" : isMinimized ? "calc(100% + -24px)" : "calc(50% + 0px)",
          x: isMaximized ? "-0%" : isMinimized ? "-100%" : "-50%",
          y: isMaximized ? "-0%" : isMinimized ? "-100%" : "-50%",
          width: isMaximized ? "calc(100% + 0px)" : isMinimized ? "calc(0% + 280px)" : "calc(100% + -32px)",
          maxWidth: isMaximized ? "calc(0% + 5000px)" : isMinimized ? "calc(0% + 280px)" : "calc(0% + 720px)",
          height: isMaximized ? "calc(100% + -30px)" : isMinimized ? "calc(0% + 48px)" : "calc(100% + -32px)",
          maxHeight: isMaximized ? "calc(0% + 5000px)" : isMinimized ? "calc(0% + 48px)" : "calc(0% + 680px)",
          borderRadius: isMaximized ? "0px" : isMinimized ? "12px" : "16px",
        }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
        className={cn(
          "compose-window absolute overflow-hidden flex flex-col pointer-events-auto",
          isMaximized && "border-x-0 border-b-0",
          isMinimized && "cursor-pointer"
        )}
      >
        <h2 id={titleId} className="sr-only">Compose message</h2>
        {/* ---------------------------------------------------------------- */}
        {/* Window Header */}
        {/* ---------------------------------------------------------------- */}
        <header
          onClick={() => {
            if (isMinimized) setComposeWindowState("normal");
          }}
          className={cn(
            "compose-header flex items-center justify-between px-5 select-none flex-shrink-0",
            isMinimized ? "h-[48px]" : "h-[64px]",
            !isMinimized && "border-b border-black/5 dark:border-white/5",
            isMinimized && "cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          )}
        >
          <div className="flex items-center gap-3 overflow-hidden">
            {composeStatus === "sent" ? (
              <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs font-semibold">Message Sent</span>
              </div>
            ) : composeStatus === "failed" ? (
              <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-xs font-semibold">Failed to Send</span>
              </div>
            ) : composeStatus === "sending" ? (
              <div className="flex items-center gap-2">
                <motion.div
                  className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full shrink-0"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                />
                <span className="text-xs font-semibold text-foreground/70 dark:text-white/70 truncate max-w-[200px]">
                  Sending: {subject || "(No Subject)"}
                </span>
                {!isMinimized && attachments.length > 0 && (
                  <motion.button
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.8 }}
                    aria-label="Minimize message" title="Minimize (Esc)"
                  onClick={(e) => { e.stopPropagation(); setComposeWindowState("minimized"); }}
                    className="ml-2 px-2.5 py-1 bg-primary/10 hover:bg-primary/20 text-primary rounded-md text-[10px] font-bold transition-colors hidden sm:flex items-center gap-1.5 shadow-sm"
                  >
                    <Minus className="w-3 h-3" /> Hide to background
                  </motion.button>
                )}
              </div>
            ) : (
              <>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Pencil className="size-4" /></span>
                <div className="min-w-0"><h1 className="truncate text-[13px] font-semibold">{isMinimized ? subject || 'New message' : 'New message'}</h1>{!isMinimized && user?.email && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">From {user.email}</p>}</div>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {composeStatus === "failed" && isMinimized && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setComposeWindowState("normal");
                  setComposeStatus("draft");
                }}
                className="px-2.5 py-1 mr-1 text-[11px] font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
              >
                Retry / Open
              </button>
            )}
            {!isMinimized && (
              <>
                <button
                  aria-label="Minimize message" title="Minimize (Esc)"
                  onClick={(e) => { e.stopPropagation(); setComposeWindowState("minimized"); }}
                  className="p-1.5 text-foreground/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <button
                  aria-label={isMaximized ? "Restore message size" : "Maximize message"} title={isMaximized ? "Restore size" : "Maximize"}
                  onClick={(e) => { e.stopPropagation(); setComposeWindowState(isMaximized ? "normal" : "maximized"); }}
                  className="p-1.5 text-foreground/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors"
                >
                  <Square className="w-3 h-3" />
                </button>
              </>
            )}
            {isMinimized && <button type="button" aria-label="Restore message" title="Restore message" className="compose-tool" onClick={event => { event.stopPropagation(); setComposeWindowState('normal'); }}><Square className="size-3.5" /></button>}
            <button type="button" aria-label={isSending ? "Minimize sending message" : "Close message"} title={isSending ? "Minimize while sending" : "Close"}
              onClick={event => { event.stopPropagation(); void requestClose(); }}
              className="p-1.5 text-foreground/60 dark:text-white/60 hover:bg-red-500 hover:text-white dark:hover:bg-red-500/90 rounded-md transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        <motion.div
          animate={{
            height: isMinimized ? 0 : "auto",
            opacity: isMinimized ? 0 : 1
          }}
          className="min-h-0 flex-1 flex flex-col overflow-hidden"
          inert={isMinimized || isHidden}
          style={{ pointerEvents: isMinimized ? "none" : "auto" }}
        >
          {/* ---------------------------------------------------------------- */}
          {/* Recipient & Subject */}
          {/* ---------------------------------------------------------------- */}
          <fieldset disabled={editingDisabled} className="compose-fields min-w-0 flex flex-col flex-shrink-0">
            {/* To Field */}
            <div className="compose-address-row relative">
              <label htmlFor="compose-to" className="compose-field-label">To</label>
              <div className="flex max-h-28 min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-y-auto py-1 custom-scrollbar">
                {recipients.map((email: string) => (
                  <motion.div
                    layout
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    key={email}
                    className={cn("compose-recipient-chip", !validAddress(email) && "is-invalid")}
                  >
                    <span className="min-w-0 truncate" title={email}>{email}</span>
                    <button type="button" aria-label={`Remove ${email}`} onClick={() => removeRecipient(email)} className="shrink-0 rounded p-0.5 hover:bg-primary/10"><X className="size-3" /></button>
                  </motion.div>
                ))}
                <input
                  id="compose-to"
                  aria-label="To recipients"
                  aria-controls={isOpen ? contactsId : undefined}
                  aria-invalid={invalidRecipient}
                  onBlur={commitRecipient}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={isOpen}
                  aria-activedescendant={
                    isOpen && filteredContacts.length > 0
                      ? `${contactsId}-${selectedIndex}`
                      : undefined
                  }
                  className="flex-1 bg-transparent border-none focus:ring-0 text-sm p-0 placeholder:text-muted-foreground/50 dark:placeholder:text-white/40 text-foreground dark:text-white/90 outline-none min-w-[80px]"
                  placeholder={
                    recipients.length === 0 ? "Add people or email addresses" : "Add another…"
                  }
                  type="text"
                  value={inputValue}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown as React.KeyboardEventHandler}
                  autoFocus
                />
              </div>

              <button type="button" aria-expanded={showCopies} aria-controls="compose-copies" aria-label={showCopies ? "Hide Cc and Bcc" : cc || bcc ? "Show included Cc and Bcc recipients" : "Add Cc and Bcc"} onClick={() => setShowCopies(value => !value)} className="compose-copies-toggle" title={showCopies ? 'Hide copy fields' : 'Add Cc or Bcc'}>{showCopies ? 'Hide' : 'Cc / Bcc'}{!showCopies && (cc || bcc) && <span className="ml-1 size-1 rounded-full bg-primary" />}</button>
              <div className="relative flex-shrink-0">
                <button
                  onClick={toggleOpen}
                  aria-label="Browse contacts"
                  className={cn(
                    "p-1.5 rounded-full flex items-center justify-center transition-all",
                    isOpen
                      ? "bg-primary text-white"
                      : "text-primary hover:bg-primary/10"
                  )}
                >
                  <UserPlus className="w-4 h-4" />
                </button>

                {/* Contacts Dropdown */}
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      id={contactsId}
                      role="listbox"
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      className="compose-contacts-popover"
                    >
                      <div className="px-3 pb-2 border-b border-black/5 dark:border-white/5">
                        <span className="text-[10px] font-bold text-muted-foreground/60 dark:text-white/40 uppercase tracking-widest">
                          Suggested Contacts
                        </span>
                      </div>
                      <div className="max-h-48 overflow-y-auto custom-scrollbar pt-1">
                        {filteredContacts.length === 0 ? (
                          <div className="px-3 py-4 text-center text-sm text-muted-foreground/60 dark:text-white/40">
                            No matches found
                          </div>
                        ) : (
                          filteredContacts.map(
                            (contact: { email: string; name: string }, index: number) => (
                              <button
                                key={contact.email}
                                ref={(el) => {
                                  optionsRef.current[index] = el;
                                }}
                                role="option"
                                id={`${contactsId}-${index}`}
                                aria-selected={index === selectedIndex}
                                onMouseDown={event => event.preventDefault()}
                                onClick={() => { addRecipient(contact.email); setInputValue(""); toggleOpen(); }}
                                onMouseEnter={() => setSelectedIndex(index)}
                                className={cn(
                                  "w-full flex flex-col items-start px-3 py-2 transition-colors group border-b border-black/[0.02] dark:border-white/[0.02] last:border-0",
                                  index === selectedIndex
                                    ? "bg-primary/20"
                                    : "hover:bg-primary/10"
                                )}
                              >
                                <span className="text-sm font-semibold text-foreground dark:text-white/90 group-hover:text-primary transition-colors">
                                  {contact.name}
                                </span>
                                <span className="text-xs text-muted-foreground dark:text-white/50 truncate w-full text-left">
                                  {contact.email}
                                </span>
                              </button>
                            )
                          )
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {showCopies && <div id="compose-copies">{([{ label: 'Cc', value: cc, set: setCc }, { label: 'Bcc', value: bcc, set: setBcc }]).map(field => <label key={field.label} className="compose-address-row"><span className="compose-field-label">{field.label}</span><input aria-label={field.label} value={field.value} onChange={event => field.set(event.target.value)} placeholder={field.label === 'Bcc' ? 'Private copy · comma-separated addresses' : 'Copy · comma-separated addresses'} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60" /></label>)}</div>}
            {/* Subject Field */}
            <div className="compose-address-row">
              <label htmlFor="compose-subject" className="compose-field-label">Subject</label>
              <input
                id="compose-subject"
                ref={subjectRef}
                className="flex-1 bg-transparent border-none focus:ring-0 text-sm p-0 placeholder:text-muted-foreground/50 dark:placeholder:text-white/40 text-foreground dark:text-white/90 font-medium outline-none"
                placeholder="Enter subject line"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                onKeyDown={handleSubjectKeyDown}
              />
            </div>
          </fieldset>

          {/* ---------------------------------------------------------------- */}
          {/* Attachments Area */}
          {/* ---------------------------------------------------------------- */}
          {(attachments.length > 0 || isAttaching) && (
            <div className="px-6 py-3 border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] flex flex-col flex-shrink-0 max-h-[160px]">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <span className="text-[11px] font-semibold text-muted-foreground/80 dark:text-white/50 uppercase tracking-widest">
                  Attachments {attachments.length > 0 ? `(${attachments.length})` : ""}
                </span>
                {attachments.length > 0 && (
                  <span className="text-[11px] font-medium text-muted-foreground/60 dark:text-white/40">
                    {(attachments.reduce((sum, a) => sum + a.size, 0) / (1024 * 1024)).toFixed(2)} MB / 18.00 MB
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2 overflow-y-auto custom-scrollbar pr-2 min-h-0 pb-1">
                {attachments.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 bg-white dark:bg-[#2A2A32] border border-black/10 dark:border-white/10 rounded-lg pl-3 pr-1.5 py-1.5 shadow-sm w-fit"
                  >
                    <div className="flex items-center justify-center w-6 h-6 rounded bg-primary/10 text-primary shrink-0">
                      <Paperclip className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex flex-col max-w-[180px]">
                      <span className="text-xs font-medium text-foreground dark:text-white/90 truncate">
                        {file.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground dark:text-white/50">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={composeStatus === "sending" || composeStatus === "sent"}
                      aria-label={`Remove attachment ${file.name}`}
                      onClick={() => removeAttachment(file.id)}
                      className="ml-1 p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {isAttaching && (
                  <div className="flex items-center gap-3 bg-white/50 dark:bg-[#2A2A32]/50 border border-black/5 dark:border-white/5 rounded-lg px-3 py-1.5 shadow-sm w-[180px] overflow-hidden relative">
                    <motion.div
                      className="absolute inset-0 bg-primary/10"
                      initial={{ x: "-100%" }}
                      animate={{ x: "100%" }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                    />
                    <div className="flex items-center justify-center w-6 h-6 rounded bg-primary/10 text-primary shrink-0 z-10">
                      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                        <Paperclip className="w-3.5 h-3.5" />
                      </motion.div>
                    </div>
                    <div className="flex flex-col z-10">
                      <span className="text-xs font-medium text-foreground dark:text-white/90">
                        Processing...
                      </span>
                      <span className="text-[10px] text-muted-foreground dark:text-white/50">
                        Reading files
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Rich Text Editor Area */}
          {/* ---------------------------------------------------------------- */}
          <div className="compose-writing-area flex-1 overflow-y-auto px-6 py-5 flex flex-col min-h-0 relative" style={{ "--compose-font": preferences.composeFont === "serif" ? "Georgia, serif" : preferences.composeFont === "monospace" ? "Courier New, monospace" : "Arial, sans-serif" } as React.CSSProperties}>
            <RichTextEditor
              editable={!editingDisabled}
              autoFocus={false}
              onChange={setEditorValue}
              onReady={handleEditorReady}
              onRequestLinkInsert={openLinkDialog}
            />
            {/* Link dialog renders inside the editor area so it's contained */}
            <LinkDialog key={linkDialog ? `${linkDialog.from}:${linkDialog.to}:${linkDialog.initialUrl}` : "closed"}
              open={linkDialog?.open ?? false}
              initialUrl={linkDialog?.initialUrl ?? "https://"}
              isEditing={linkDialog?.isEditing ?? false}
              onConfirm={handleLinkConfirm}
              onCancel={handleLinkCancel}
            />

            {/* Toast Notification */}
            <AnimatePresence>
              {toast && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  role="status" className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-[#1a1a1f]/95 dark:bg-[#2A2A32]/95 backdrop-blur-md border border-white/[0.08] text-white text-xs font-medium rounded-lg shadow-xl shadow-black/20 flex items-center gap-2 max-w-[80%]"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="break-words">{toast.message}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Bottom Toolbar & Actions */}
          {/* ---------------------------------------------------------------- */}
          <footer className="compose-footer">
            <ComposeToolbar editor={editorRef.current} onLink={() => openLinkDialog()} disabled={editingDisabled} />
            <div className="compose-action-row">
              <button type="button" onClick={handleAttachFiles} disabled={editingDisabled || isAttaching} className="compose-attach-button" title="Attach files"><Paperclip className={cn('size-4', isAttaching && 'animate-pulse')} /><span className="hidden sm:inline">{isAttaching ? 'Preparing…' : 'Attach files'}</span></button>
              <div className="min-w-0 flex-1"><p id="compose-send-help" className={cn('truncate text-[11px]', invalidRecipient || copiesInvalid ? 'text-red-500' : 'text-muted-foreground')} title={sendDisabledReason || formatCharCount(editorValue.characterCount)}>{sendDisabledReason || formatCharCount(editorValue.characterCount)}</p></div>
              <button type="button" onClick={() => { void requestClose(); }} disabled={editingDisabled} aria-label="Discard message" title="Discard message" className="compose-tool hover:!bg-red-500/10 hover:!text-red-500"><Trash2 className="size-4" /></button>
              <button type="button" onClick={() => { void handleSend(); }} disabled={isSendDisabled} aria-label="Send message" aria-describedby="compose-send-help" title={sendDisabledReason || 'Send message (Ctrl+Enter)'} className="compose-send-button">{isSending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-3.5" />}<span>{isSending ? 'Sending…' : composeStatus === 'sent' ? 'Sent' : 'Send'}</span></button>
            </div>
          </footer>
        </motion.div>
      </motion.div>
    </div>
  );
}
