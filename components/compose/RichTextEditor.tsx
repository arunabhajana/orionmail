"use client";

/**
 * RichTextEditor.tsx — TipTap v3 compatible
 *
 * Key v3 changes applied here:
 * - StarterKit `history` option renamed to `undoRedo`
 * - StarterKit v3 now bundles Link and Underline — configured via StarterKit
 *   (adding them separately causes duplicate registration errors)
 * - Link.validate (deprecated) replaced with Link.shouldAutoLink
 * - Link.isAllowedUri added for XSS protection
 * - immediatelyRender: false — v3 SSR hydration guard for Next.js App Router
 * - Stable callback refs prevent stale closures in TipTap internal handlers
 */

import React, { useEffect, useCallback, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface RichTextEditorValue {
  html: string;
  plainText: string;
  json: JSONContent;
  characterCount: number;
  isEmpty: boolean;
}

/** Context passed to onRequestLinkInsert so parent can restore selection */
export interface LinkInsertContext {
  existingHref?: string;
  hasSelection: boolean;
  from: number;
  to: number;
}

export interface RichTextEditorProps {
  /** Initial HTML content (for future draft restore) */
  value?: string;
  /** Autofocus the editor on mount */
  autoFocus?: boolean;
  /** Fired on every content change */
  onChange: (value: RichTextEditorValue) => void;
  /** Fired once when editor is ready — use to get a stable Editor ref */
  onReady?: (editor: Editor) => void;
  /**
   * Called when the user triggers link insertion (Ctrl+K or toolbar button).
   * Parent should show its own link dialog and call editor.setLink() on confirm.
   */
  onRequestLinkInsert?: (ctx: LinkInsertContext) => void;
}

// --------------------------------------------------------------------------
// URL helpers (isSafeUrl is used by the Link extension's shouldAutoLink/isAllowedUri)
// --------------------------------------------------------------------------

/** Reject dangerous protocol schemes */
function isSafeUrl(url: string): boolean {
  const n = url.trim().toLowerCase();
  return (
    !n.startsWith("javascript:") &&
    !n.startsWith("vbscript:") &&
    !n.startsWith("data:")
  );
}

// --------------------------------------------------------------------------
// Build the value object from the editor (pure, no side effects)
// --------------------------------------------------------------------------

function buildValue(editor: Editor): RichTextEditorValue {
  const html = editor.getHTML();
  const plainText = editor.getText();
  const json = editor.getJSON();
  return {
    html,
    plainText,
    json,
    characterCount: plainText.length,
    isEmpty: editor.isEmpty,
  };
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export default function RichTextEditor({
  value,
  autoFocus = false,
  onChange,
  onReady,
  onRequestLinkInsert,
}: RichTextEditorProps) {
  // Stable refs — TipTap closures capture these once at setup time.
  // Without refs, stale closures would call outdated callbacks.
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const onRequestLinkInsertRef = useRef(onRequestLinkInsert);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { onRequestLinkInsertRef.current = onRequestLinkInsert; }, [onRequestLinkInsert]);

  const editor = useEditor({
    /**
     * v3 REQUIRED for Next.js App Router:
     * Prevents server-rendered HTML from mismatching the client-rendered editor.
     * Without this, React throws a hydration error on first render.
     */
    immediatelyRender: false,

    extensions: [
      /**
       * StarterKit v3 bundles: Bold, Italic, Strike, Code, CodeBlock, Blockquote,
       * HorizontalRule, BulletList, OrderedList, ListItem, HardBreak, Heading,
       * Link, Underline, UndoRedo, Dropcursor, Gapcursor, TrailingNode.
       *
       * We disable the ones we don't want for email-safe v1 output.
       * We configure Link and Underline here (NOT as separate extensions)
       * to avoid the "Extension registered twice" error in v3.
       */
      StarterKit.configure({
        // --- Disabled: not email-safe or out of v1 scope ---
        heading: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,

        // --- v3 rename: was `history`, now `undoRedo` ---
        undoRedo: {},

        // --- Link: configured here to avoid duplicate registration ---
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: {
            // Open in system browser, not Tauri webview
            target: "_blank",
            rel: "noopener noreferrer",
          },
          // v3: use shouldAutoLink instead of deprecated `validate`
          shouldAutoLink: (url) => isSafeUrl(url),
          // v3: isAllowedUri is the XSS guard (replaces validate for rendering)
          isAllowedUri: (url, { defaultValidate }) => {
            return isSafeUrl(url) && defaultValidate(url);
          },
        },

        // --- Underline: configured here to avoid duplicate registration ---
        underline: {},
      }),

      TextAlign.configure({
        types: ["paragraph"],
        alignments: ["left", "center", "right"],
        // Note: `defaultAlignment` was removed in v3 — omit it
      }),

      Placeholder.configure({
        placeholder: "Write your message here...",
        // `emptyEditorClass` is still valid in v3 (confirmed from source)
        emptyEditorClass: "is-editor-empty",
      }),
    ],

    content: value ?? "",
    autofocus: autoFocus ? "end" : false,

    editorProps: {
      attributes: {
        // Scoped CSS class — stripped before email send, NOT in output HTML
        class: "orion-editor",
        role: "textbox",
        "aria-label": "Email body",
        "aria-multiline": "true",
        spellcheck: "true",
        autocorrect: "off",
        autocomplete: "off",
      },
    },

    onUpdate({ editor }) {
      onChangeRef.current(buildValue(editor));
    },

    onCreate({ editor }) {
      // Emit initial state immediately so parent starts with correct isEmpty/html
      onChangeRef.current(buildValue(editor));
      onReadyRef.current?.(editor);
    },
  });

  // --------------------------------------------------------------------------
  // Ctrl+K: Trigger link insert UI (no window.prompt — parent shows its dialog)
  // --------------------------------------------------------------------------
  const handleCtrlK = useCallback(
    (event: KeyboardEvent) => {
      if (!editor) return;
      if (!((event.ctrlKey || event.metaKey) && event.key === "k")) return;

      event.preventDefault();
      event.stopPropagation(); // Prevent browser from intercepting

      const { from, to } = editor.state.selection;
      const hasSelection = from !== to;
      const existingHref = editor.getAttributes("link").href as string | undefined;

      // Nothing selected and not inside a link → no-op
      if (!hasSelection && !existingHref) return;

      // Delegate to parent — parent owns the dialog UI
      onRequestLinkInsertRef.current?.({ existingHref, hasSelection, from, to });
    },
    [editor]
  );

  useEffect(() => {
    const dom = editor?.view?.dom;
    if (!dom) return;
    dom.addEventListener("keydown", handleCtrlK);
    return () => dom.removeEventListener("keydown", handleCtrlK);
  }, [editor, handleCtrlK]);

  // --------------------------------------------------------------------------
  // Draft restore: sync incoming `value` prop → editor content
  // The guard prevents cursor resets on every keystroke.
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!editor || value === undefined) return;
    if (editor.getHTML() !== value) {
      // v3: second arg is now an options object, not a boolean
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  // --------------------------------------------------------------------------
  // Render
  // The wrapper div fills the full compose pane via flex.
  // [&_.ProseMirror] targets the inner div TipTap renders and makes it fill.
  // --------------------------------------------------------------------------
  return (
    <div className="flex flex-col flex-1 min-h-0 h-full cursor-text">
      <EditorContent
        editor={editor}
        className="flex-1 min-h-0 h-full [&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none"
      />
    </div>
  );
}
