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

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface ComposeModalProps {
  onClose: () => void;
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

export default function ComposeModal({ onClose }: ComposeModalProps) {
  const [subject, setSubject] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);

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
      alert("Please add at least one recipient.");
      return;
    }
    if (editorValue.isEmpty || editorValue.plainText.trim().length === 0) {
      alert("Please write a message before sending.");
      return;
    }

    setIsSending(true);
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
      });

      setIsSending(false);
      setIsSent(true);

      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error) {
      console.error("Failed to send message:", error);
      alert(`Failed to send message: ${error}`);
      setIsSending(false);
    }
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
    isSending ||
    isSent ||
    recipients.length === 0 ||
    editorValue.isEmpty;

  // Explain WHY send is disabled (shown as tooltip on the button)
  const sendDisabledReason =
    isSending || isSent
      ? null
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
  // Render
  // --------------------------------------------------------------------------
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => !isSending && !isSent && onClose()}
        className="absolute inset-0 bg-slate-900/10 backdrop-blur-sm"
      />

      {/* Modal Window */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="relative w-full max-w-2xl bg-white/70 dark:bg-[#1C1C21]/70 backdrop-blur-2xl rounded-xl shadow-2xl border border-white/40 dark:border-white/5 overflow-hidden flex flex-col h-[600px] m-4"
      >
        {/* ---------------------------------------------------------------- */}
        {/* Success Overlay */}
        {/* ---------------------------------------------------------------- */}
        <AnimatePresence>
          {isSent && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/90 dark:bg-[#1C1C21]/90 backdrop-blur-xl"
            >
              <motion.div
                animate={{ scale: [0, 1, 1, 0] }}
                transition={{
                  duration: 2,
                  times: [0, 0.2, 0.8, 1],
                  ease: ["backOut", "linear", "easeIn"],
                }}
                className="w-24 h-24 bg-primary/20 rounded-full flex items-center justify-center mb-6 relative shadow-[0_0_40px_rgba(var(--primary),0.3)]"
              >
                <motion.div
                  initial={{ scale: 0.8, opacity: 1 }}
                  animate={{ scale: 1.5, opacity: 0 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "easeOut" }}
                  className="absolute inset-0 bg-primary/30 rounded-full"
                />
                <motion.div
                  animate={{
                    x: [-80, 0, 0, 400],
                    y: [80, 0, 0, -400],
                    opacity: [0, 1, 1, 0],
                    scale: [0.5, 1, 1, 0.5],
                  }}
                  transition={{
                    duration: 2,
                    times: [0, 0.25, 0.75, 1],
                    ease: ["backOut", "linear", "backIn"],
                  }}
                >
                  <Send className="w-10 h-10 text-primary ml-1 mt-1" />
                </motion.div>
              </motion.div>

              <motion.h3
                animate={{ opacity: [0, 1, 1, 0], y: [20, 0, 0, -20] }}
                transition={{
                  duration: 2,
                  times: [0, 0.2, 0.8, 1],
                  ease: ["backOut", "linear", "easeIn"],
                }}
                className="text-2xl font-bold text-foreground dark:text-white mb-2 tracking-tight"
              >
                Message Sent
              </motion.h3>

              <motion.p
                animate={{ opacity: [0, 1, 1, 0], y: [10, 0, 0, -10] }}
                transition={{
                  duration: 2,
                  times: [0, 0.2, 0.8, 1],
                  ease: ["easeOut", "linear", "easeIn"],
                }}
                className="text-muted-foreground dark:text-white/60"
              >
                Your email is on its way.
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---------------------------------------------------------------- */}
        {/* Window Header */}
        {/* ---------------------------------------------------------------- */}
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-black/5 dark:border-white/5 select-none flex-shrink-0">
          <div className="flex items-center gap-3">
            <Pencil className="w-3.5 h-3.5 text-primary" />
            <h1 className="text-xs font-semibold text-foreground/70 dark:text-white/70 tracking-tight">
              New Message
            </h1>
          </div>

          <div className="flex items-center gap-1">
            <button className="p-2 text-foreground/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button className="p-2 text-foreground/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors">
              <Square className="w-3 h-3" />
            </button>
            <button
              onClick={() => !isSending && !isSent && onClose()}
              disabled={isSending || isSent}
              className="p-2 text-foreground/60 dark:text-white/60 hover:bg-red-500 hover:text-white dark:hover:bg-red-500/90 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

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

            {/* Attachment — dummy until implemented */}
            <Tooltip label="Attachments (Coming Soon)" align="end">
              <button
                type="button"
                disabled
                aria-label="Attach file (coming soon)"
                className="p-1.5 rounded-md opacity-40 cursor-not-allowed text-foreground/40 dark:text-white/40"
              >
                <Paperclip className="w-4 h-4" />
              </button>
            </Tooltip>

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
                    {isSending ? "Sending..." : "Send"}
                  </span>

                  {!isSending && !isSent && (
                    <Send className="w-3.5 h-3.5 relative z-10" />
                  )}

                  {isSending && (
                    <motion.div
                      animate={{ x: [0, 4, 0], y: [0, -2, 0] }}
                      transition={{ repeat: Infinity, duration: 1 }}
                      className="relative z-10"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </motion.div>
                  )}

                  {/* Loading shimmer */}
                  {isSending && (
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
    </div>
  );
}
