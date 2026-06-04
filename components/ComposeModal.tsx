"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Minus,
  Square,
  Pencil,
  Paperclip,
  Image as ImageIcon,
  Bold,
  Italic,
  Underline,
  Trash2,
  Send,
  UserPlus,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link as LinkIcon,
  Undo2,
  Redo2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { useRecipientAutocomplete } from "@/hooks/useRecipientAutocomplete";
import RichTextEditor, {
  RichTextEditorValue,
  type LinkInsertContext,
} from "@/components/compose/RichTextEditor";
import { emailSafeCleanup, wrapEmailHtml } from "@/lib/email-safe-cleanup";
import type { Editor } from "@tiptap/core";
import DOMPurify from "isomorphic-dompurify";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface ComposeModalProps {
  onClose: () => void;
}

export interface AttachmentFile {
  id: string;
  path: string;
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
// Tooltip — dark glassmorphism, align-aware so it never overflows the modal
// --------------------------------------------------------------------------

interface TooltipProps {
  label: string;
  children: React.ReactNode;
  /** Controls which edge the tooltip bubble aligns to */
  align?: "start" | "center" | "end";
}

function Tooltip({ label, children, align = "center" }: TooltipProps) {
  const bubbleCls = {
    start: "left-0",
    center: "left-1/2 -translate-x-1/2",
    end: "right-0",
  }[align];
  const arrowCls = {
    start: "left-3",
    center: "left-1/2 -translate-x-1/2",
    end: "right-3",
  }[align];

  return (
    <div className="relative group">
      {children}
      <div
        role="tooltip"
        className={cn(
          "absolute bottom-full mb-2.5 px-2.5 py-1",
          bubbleCls,
          // Always-dark frosted glass — readable on both light and dark backgrounds
          "bg-[#1a1a1f]/95 backdrop-blur-md",
          "border border-white/[0.08]",
          "text-white text-[10px] font-medium leading-tight",
          "rounded-md whitespace-nowrap shadow-xl shadow-black/40",
          "pointer-events-none opacity-0 group-hover:opacity-100",
          "transition-all duration-150 z-[200]",
          "scale-95 group-hover:scale-100 origin-bottom"
        )}
      >
        {label}
        <div
          className={cn(
            "absolute top-full w-0 h-0",
            arrowCls,
            "border-l-[4px] border-l-transparent",
            "border-r-[4px] border-r-transparent",
            "border-t-[4px] border-t-[#1a1a1f]/95"
          )}
        />
      </div>
    </div>
  );
}


// --------------------------------------------------------------------------
// ToolbarDivider
// --------------------------------------------------------------------------

function ToolbarDivider() {
  return <div className="w-[1px] h-5 bg-black/10 dark:bg-white/10 mx-0.5 flex-shrink-0" />;
}

// --------------------------------------------------------------------------
// ToolbarButton — now accepts tooltipAlign
// --------------------------------------------------------------------------

interface ToolbarButtonProps {
  onClick?: () => void;
  isActive?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
  "aria-label"?: string;
  tooltipAlign?: "start" | "center" | "end";
}

function ToolbarButton({
  onClick,
  isActive = false,
  disabled = false,
  label,
  children,
  "aria-label": ariaLabel,
  tooltipAlign = "center",
}: ToolbarButtonProps) {
  return (
    <Tooltip label={label} align={tooltipAlign}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel || label}
        aria-pressed={isActive}
        className={cn(
          "p-1.5 rounded-md transition-all duration-100 flex items-center justify-center flex-shrink-0",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1",
          disabled
            ? "opacity-40 cursor-not-allowed text-foreground/40 dark:text-white/40"
            : isActive
            ? "bg-primary/15 text-primary dark:bg-primary/20 dark:text-primary"
            : "text-foreground/70 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground dark:hover:text-white"
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
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
      setUrl(initialUrl);
      setError("");
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

export default function ComposeModal({ onClose }: ComposeModalProps) {
  const [subject, setSubject] = useState("");
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [isAttaching, setIsAttaching] = useState(false);

  const [composeWindowState, setComposeWindowState] = useState<ComposeWindowState>("normal");
  const windowStateRef = useRef<ComposeWindowState>("normal");
  useEffect(() => {
    windowStateRef.current = composeWindowState;
  }, [composeWindowState]);

  const [composeStatus, setComposeStatus] = useState<ComposeStatus>("draft");
  const [dockPosition] = useState("bottom-right");

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
  } = useRecipientAutocomplete();

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
    if (recipients.length === 0) {
      showToast("Please add at least one recipient.");
      return;
    }
    if (editorValue.isEmpty || editorValue.plainText.trim().length === 0) {
      showToast("Please write a message before sending.");
      return;
    }

    setComposeStatus("sending");
    try {
      // Cleanup pipeline: strip TipTap attrs → DOMPurify → wrap
      const cleaned = emailSafeCleanup(editorValue.html);
      const sanitized = DOMPurify.sanitize(cleaned);
      const htmlBody = wrapEmailHtml(sanitized);
      const plainBody = editorValue.plainText;

      await invoke("send_message", {
        to: recipients,
        cc: [],
        bcc: [],
        replyTo: null,
        subject,
        plainBody,
        htmlBody,
        attachments: attachments.map(a => a.path),
      });

      setComposeStatus("sent");
      
      setTimeout(() => {
        if (windowStateRef.current !== "hidden") {
          onClose();
        }
      }, 2000);
    } catch (error) {
      console.error("Failed to send message:", error);
      setComposeStatus("failed");
      setComposeWindowState(prev => prev === "hidden" ? "minimized" : prev);
    }
  };

  // --------------------------------------------------------------------------
  // Attachment handlers
  // --------------------------------------------------------------------------
  const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024; // 18MB raw (~24MB base64)
  const MAX_ATTACHMENTS = 25;

  const handleAttachFiles = async () => {
    try {
      const selectedPaths = await open({
        multiple: true,
        directory: false,
      });

      if (!selectedPaths || selectedPaths.length === 0) return;

      const paths = Array.isArray(selectedPaths) ? selectedPaths : [selectedPaths];

      // Validate max count
      if (attachments.length + paths.length > MAX_ATTACHMENTS) {
        showToast(`You can only attach up to ${MAX_ATTACHMENTS} files.`);
        return;
      }

      setIsAttaching(true);

      // Filter out already attached files
      const newPaths = paths.filter(p => !attachments.some(a => a.path === p));
      
      if (newPaths.length === 0) {
        setIsAttaching(false);
        return;
      }

      // Get metadata from backend
      const newAttachments: AttachmentFile[] = await invoke("get_attachment_metadata", {
        paths: newPaths
      });

      const totalSize = attachments.reduce((sum, a) => sum + a.size, 0) + 
                        newAttachments.reduce((sum, a) => sum + a.size, 0);

      if (totalSize > MAX_ATTACHMENT_BYTES) {
        showToast("Files exceed the 18MB size limit. Please remove some attachments.");
        setIsAttaching(false);
        return;
      }

      const attachmentsWithId = newAttachments.map(a => ({
        ...a,
        id: Math.random().toString(36).substring(7),
        addedAt: Date.now()
      }));

      setAttachments(prev => [...prev, ...attachmentsWithId]);
      setIsAttaching(false);
    } catch (error) {
      console.error("Failed to attach files:", error);
      showToast("Could not attach files. They might be moved or deleted.");
      setIsAttaching(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  // --------------------------------------------------------------------------
  // Toolbar: derive active states from editor
  // --------------------------------------------------------------------------
  const editor = editorRef.current;

  // Force re-render when editor selection/marks change so toolbar stays in sync.
  // We subscribe via onUpdate + onSelectionUpdate in the editor (handled by
  // TipTap itself — the EditorContent re-renders the parent only if we track
  // something. We use a counter to trigger it).
  const [, setTick] = useState(0);

  const handleEditorReady = useCallback((e: Editor) => {
    editorRef.current = e;
    setTick((t) => t + 1);

    // Subscribe to selection updates so toolbar stays live
    e.on("selectionUpdate", () => setTick((t) => t + 1));
    e.on("transaction", () => setTick((t) => t + 1));
  }, []);

  const isActive = useCallback(
    (name: string, attrs?: Record<string, unknown>) => {
      return editorRef.current?.isActive(name, attrs) ?? false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const canUndo = editorRef.current?.can().undo() ?? false;
  const canRedo = editorRef.current?.can().redo() ?? false;

  const isSendDisabled =
    composeStatus === "sending" ||
    composeStatus === "sent" ||
    isAttaching ||
    recipients.length === 0 ||
    editorValue.isEmpty;

  // Explain WHY send is disabled (shown as tooltip on the button)
  const sendDisabledReason =
    composeStatus === "sending" || composeStatus === "sent"
      ? null
      : isAttaching
      ? "Please wait for attachments to process"
      : recipients.length === 0
      ? "Add at least one recipient"
      : editorValue.isEmpty
      ? "Write a message first"
      : null;

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
      if (e.key === "Escape" && !linkDialog) {
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
        "fixed z-50 flex transition-all duration-300",
        isHidden ? "opacity-0 pointer-events-none -z-10" : "opacity-100",
        isMinimized ? "inset-x-0 bottom-0 p-6 items-end justify-end pointer-events-none" : "inset-0 items-center justify-center pointer-events-auto"
      )}
    >
      {/* Backdrop */}
      {!isMinimized && !isHidden && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => composeStatus === "draft" && onClose()}
          className="absolute inset-0 bg-slate-900/10 backdrop-blur-sm"
        />
      )}

      {/* Modal Window */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ 
          opacity: isHidden ? 0 : 1, 
          scale: 1, 
          y: 0,
          width: isMaximized ? "100vw" : isMinimized ? 280 : "100%",
          height: isMaximized ? "100vh" : isMinimized ? 48 : 600,
          borderRadius: isMaximized ? 0 : isMinimized ? 12 : 16,
        }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={cn(
          "relative bg-white/95 dark:bg-[#1C1C21]/95 backdrop-blur-2xl shadow-2xl border border-black/10 dark:border-white/10 overflow-hidden flex flex-col pointer-events-auto",
          !isMaximized && !isMinimized && "max-w-2xl m-4"
        )}
      >
        {/* ---------------------------------------------------------------- */}
        {/* Window Header */}
        {/* ---------------------------------------------------------------- */}
        <header 
          onClick={() => {
            if (isMinimized && composeStatus === "draft") setComposeWindowState("normal");
          }}
          className={cn(
            "flex items-center justify-between px-4 select-none flex-shrink-0",
            isMinimized ? "h-[48px]" : "py-3",
            !isMinimized && "border-b border-black/5 dark:border-white/5",
            isMinimized && composeStatus === "draft" && "cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
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
                    onClick={(e) => { e.stopPropagation(); setComposeWindowState("minimized"); }}
                    className="ml-2 px-2.5 py-1 bg-primary/10 hover:bg-primary/20 text-primary rounded-md text-[10px] font-bold transition-colors hidden sm:flex items-center gap-1.5 shadow-sm"
                  >
                    <Minus className="w-3 h-3" /> Hide to background
                  </motion.button>
                )}
              </div>
            ) : (
              <>
                <Pencil className="w-3.5 h-3.5 text-primary shrink-0" />
                <h1 className="text-xs font-semibold text-foreground/70 dark:text-white/70 tracking-tight truncate max-w-[200px]">
                  {isMinimized ? `Draft: ${subject || "(No Subject)"}` : "New Message"}
                </h1>
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
                  onClick={(e) => { e.stopPropagation(); setComposeWindowState("minimized"); }}
                  className="p-1.5 text-foreground/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); setComposeWindowState(isMaximized ? "normal" : "maximized"); }}
                  className="p-1.5 text-foreground/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors"
                >
                  <Square className="w-3 h-3" />
                </button>
              </>
            )}
            <button
              onClick={(e) => { 
                e.stopPropagation(); 
                if (composeStatus === "sending") {
                  setComposeWindowState("hidden");
                } else {
                  onClose();
                }
              }}
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
          className="flex-1 flex flex-col overflow-hidden"
          style={{ pointerEvents: isMinimized ? "none" : "auto" }}
        >
          {/* ---------------------------------------------------------------- */}
          {/* Recipient & Subject */}
          {/* ---------------------------------------------------------------- */}
          <div className="flex flex-col flex-shrink-0">
            {/* To Field */}
          <div className="flex items-center gap-2 px-6 py-3 border-b border-black/5 dark:border-white/5 relative">
            <span className="text-muted-foreground dark:text-white/50 text-sm font-medium w-12 flex-shrink-0">
              To:
            </span>
            <div className="flex flex-wrap gap-2 flex-1 items-center min-h-[32px]">
              {recipients.map((email: string) => (
                <motion.div
                  layout
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  key={email}
                  className="flex items-center gap-1.5 bg-primary/10 text-primary px-2.5 py-0.5 rounded-full text-xs font-medium border border-primary/20"
                >
                  <span>{email}</span>
                  <X
                    className="w-3 h-3 cursor-pointer hover:text-primary/70"
                    onClick={() => removeRecipient(email)}
                  />
                </motion.div>
              ))}
              <input
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={isOpen}
                aria-activedescendant={
                  isOpen && filteredContacts.length > 0
                    ? `option-${selectedIndex}`
                    : undefined
                }
                className="flex-1 bg-transparent border-none focus:ring-0 text-sm p-0 placeholder:text-muted-foreground/50 dark:placeholder:text-white/40 text-foreground dark:text-white/90 outline-none min-w-[120px]"
                placeholder={
                  recipients.length === 0 ? "Add recipients..." : ""
                }
                type="text"
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown as React.KeyboardEventHandler}
                autoFocus
              />
            </div>

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
                    role="listbox"
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="absolute right-0 top-full mt-2 w-64 bg-white/80 dark:bg-[#1C1C21]/90 backdrop-blur-2xl border border-white/40 dark:border-white/10 rounded-xl shadow-2xl z-50 py-2 origin-top-right overflow-hidden shadow-primary/10"
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
                              id={`option-${index}`}
                              aria-selected={index === selectedIndex}
                              onClick={() => {
                                handleInputChange(contact.email + ", ");
                                toggleOpen();
                              }}
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

          {/* Subject Field */}
          <div className="flex items-center gap-2 px-6 py-3 border-b border-black/5 dark:border-white/5">
            <span className="text-muted-foreground dark:text-white/50 text-sm font-medium w-12 flex-shrink-0">
              Subject:
            </span>
            <input
              ref={subjectRef}
              className="flex-1 bg-transparent border-none focus:ring-0 text-sm p-0 placeholder:text-muted-foreground/50 dark:placeholder:text-white/40 text-foreground dark:text-white/90 font-medium outline-none"
              placeholder="Enter subject line"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onKeyDown={handleSubjectKeyDown}
            />
          </div>
        </div>

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
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col min-h-0 relative">
          <RichTextEditor
            autoFocus={false}
            onChange={setEditorValue}
            onReady={handleEditorReady}
            onRequestLinkInsert={openLinkDialog}
          />
          {/* Link dialog renders inside the editor area so it's contained */}
          <LinkDialog
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
                className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-[#1a1a1f]/95 dark:bg-[#2A2A32]/95 backdrop-blur-md border border-white/[0.08] text-white text-xs font-medium rounded-lg shadow-xl shadow-black/20 flex items-center gap-2 max-w-[80%]"
              >
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="truncate">{toast.message}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Bottom Toolbar & Actions */}
        {/* ---------------------------------------------------------------- */}
        <footer className="flex-shrink-0 px-3 py-2.5 border-t border-black/5 dark:border-white/5 bg-white/30 dark:bg-white/5">
          {/* Formatting Toolbar Row */}
          <div className="flex items-center gap-0.5 mb-2">
            {/* Text formatting — align=start so tooltip doesn't overflow left edge */}
            <ToolbarButton
              label="Bold (Ctrl+B)"
              isActive={isActive("bold")}
              onClick={() => editorRef.current?.chain().focus().toggleBold().run()}
              aria-label="Bold"
              tooltipAlign="start"
            >
              <Bold className="w-4 h-4" />
            </ToolbarButton>

            <ToolbarButton
              label="Italic (Ctrl+I)"
              isActive={isActive("italic")}
              onClick={() => editorRef.current?.chain().focus().toggleItalic().run()}
              aria-label="Italic"
              tooltipAlign="start"
            >
              <Italic className="w-4 h-4" />
            </ToolbarButton>

            <ToolbarButton
              label="Underline (Ctrl+U)"
              isActive={isActive("underline")}
              onClick={() => editorRef.current?.chain().focus().toggleUnderline().run()}
              aria-label="Underline"
            >
              <Underline className="w-4 h-4" />
            </ToolbarButton>

            <ToolbarDivider />

            {/* Lists */}
            <ToolbarButton
              label="Bullet List"
              isActive={isActive("bulletList")}
              onClick={() => editorRef.current?.chain().focus().toggleBulletList().run()}
              aria-label="Bullet list"
            >
              <List className="w-4 h-4" />
            </ToolbarButton>

            <ToolbarButton
              label="Numbered List"
              isActive={isActive("orderedList")}
              onClick={() => editorRef.current?.chain().focus().toggleOrderedList().run()}
              aria-label="Numbered list"
            >
              <ListOrdered className="w-4 h-4" />
            </ToolbarButton>

            <ToolbarDivider />

            {/* Alignment */}
            <ToolbarButton
              label="Align Left"
              isActive={isActive("paragraph", { textAlign: "left" })}
              onClick={() => editorRef.current?.chain().focus().setTextAlign("left").run()}
              aria-label="Align left"
            >
              <AlignLeft className="w-4 h-4" />
            </ToolbarButton>

            <ToolbarButton
              label="Align Center"
              isActive={isActive("paragraph", { textAlign: "center" })}
              onClick={() => editorRef.current?.chain().focus().setTextAlign("center").run()}
              aria-label="Align center"
            >
              <AlignCenter className="w-4 h-4" />
            </ToolbarButton>

            <ToolbarButton
              label="Align Right"
              isActive={isActive("paragraph", { textAlign: "right" })}
              onClick={() => editorRef.current?.chain().focus().setTextAlign("right").run()}
              aria-label="Align right"
            >
              <AlignRight className="w-4 h-4" />
            </ToolbarButton>

            <ToolbarDivider />

            {/* Link */}
            <ToolbarButton
              label="Insert Link (Ctrl+K)"
              isActive={isActive("link")}
              onClick={() => openLinkDialog()}
              aria-label="Insert link"
            >
              <LinkIcon className="w-4 h-4" />
            </ToolbarButton>

            <ToolbarDivider />

            {/* Undo / Redo */}
            <ToolbarButton
              label="Undo (Ctrl+Z)"
              onClick={() => editorRef.current?.chain().focus().undo().run()}
              disabled={!canUndo}
              aria-label="Undo"
            >
              <Undo2 className="w-4 h-4" />
            </ToolbarButton>

            <ToolbarButton
              label="Redo (Ctrl+Shift+Z)"
              onClick={() => editorRef.current?.chain().focus().redo().run()}
              disabled={!canRedo}
              aria-label="Redo"
            >
              <Redo2 className="w-4 h-4" />
            </ToolbarButton>

            <ToolbarDivider />

            {/* Attachment */}
            <ToolbarButton
              label={isAttaching ? "Attaching..." : "Attach files"}
              onClick={handleAttachFiles}
              disabled={composeStatus === "sending" || composeStatus === "sent" || isAttaching}
              aria-label="Attach files"
              tooltipAlign="end"
            >
              {isAttaching ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                >
                  <Paperclip className="w-4 h-4" />
                </motion.div>
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </ToolbarButton>

            {/* Image — dummy until implemented */}
            <Tooltip label="Insert Image (Coming Soon)" align="end">
              <button
                type="button"
                disabled
                aria-label="Insert image (coming soon)"
                className="p-1.5 rounded-md opacity-40 cursor-not-allowed text-foreground/40 dark:text-white/40"
              >
                <ImageIcon className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>

          {/* Send Row */}
          <div className="flex items-center justify-between">
            {/* Character Count */}
            <span className="text-[11px] text-muted-foreground/60 dark:text-white/40 tabular-nums pl-1 select-none">
              {formatCharCount(editorValue.characterCount)}
            </span>

            <div className="flex items-center gap-3">
              {/* Discard */}
              <Tooltip label="Discard draft">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Discard draft"
                  className="p-2 text-muted-foreground/80 dark:text-white/60 hover:text-red-500 transition-colors rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </Tooltip>

              {/* Send Button — wrapped in Tooltip when disabled to explain why */}
              {sendDisabledReason ? (
                <Tooltip label={sendDisabledReason} align="end">
                  <button
                    type="button"
                    disabled
                    aria-label="Send email (disabled)"
                    aria-disabled="true"
                    className="flex items-center gap-2 px-5 py-2 rounded-lg font-semibold shadow-lg text-sm bg-primary/50 text-white cursor-not-allowed opacity-60 relative overflow-hidden"
                  >
                    <span>Send</span>
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={isSendDisabled}
                  aria-label="Send email"
                  className={cn(
                    "flex items-center gap-2 px-5 py-2 rounded-lg font-semibold shadow-lg transition-all active:scale-[0.98] relative overflow-hidden text-sm",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2",
                    isSendDisabled
                      ? "bg-primary/50 text-white cursor-not-allowed opacity-60"
                      : "bg-primary hover:bg-primary/90 text-white shadow-primary/20"
                  )}
                >
                  <span className="relative z-10">
                    {composeStatus === "sending" ? "Sending..." : "Send"}
                  </span>

                  {composeStatus !== "sending" && composeStatus !== "sent" && (
                    <Send className="w-3.5 h-3.5 relative z-10" />
                  )}

                  {composeStatus === "sending" && (
                    <motion.div
                      animate={{ x: [0, 4, 0], y: [0, -2, 0] }}
                      transition={{ repeat: Infinity, duration: 1 }}
                      className="relative z-10"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </motion.div>
                  )}

                  {/* Loading shimmer */}
                  {composeStatus === "sending" && (
                    <motion.div
                      initial={{ x: "-100%" }}
                      animate={{ x: "200%" }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12 z-0"
                    />
                  )}
                </button>
              )}
            </div>
          </div>
        </footer>
        </motion.div>
      </motion.div>
    </div>
  );
}
