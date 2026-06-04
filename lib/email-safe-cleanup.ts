/**
 * email-safe-cleanup.ts
 *
 * Converts raw TipTap HTML into clean, email-safe HTML.
 * Uses DOM parsing — NOT regex — for robust attribute removal.
 *
 * Pipeline:
 *   TipTap HTML → DOMParser → Strip ProseMirror attrs → DOMPurify → Clean HTML string
 */

import DOMPurify from "isomorphic-dompurify";

/**
 * Allowed HTML tags in the final email payload.
 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "a",
  "div",
  "span",
  "hr",
  "blockquote",
];

/**
 * Allowed HTML attributes in the final email payload.
 * We explicitly keep href, target, rel (for links) and style (for alignment).
 */
const ALLOWED_ATTRS: { [key: string]: string[] } = {
  a: ["href", "target", "rel"],
  p: ["style"],
  div: ["style"],
  span: ["style"],
  li: ["style"],
  blockquote: ["style"],
};

/**
 * ProseMirror / TipTap attributes that must be stripped before sending.
 */
const PROSEMIRROR_ATTRS = [
  "class",
  "data-type",
  "data-id",
  "data-label",
  "data-url",
  "contenteditable",
  "spellcheck",
  "tabindex",
  "translate",
  "autocorrect",
  "autocomplete",
];

/**
 * Recursively walk a DOM element and strip ProseMirror attributes.
 * Preserves `style` attribute that carries text-align for alignment.
 */
function stripProseMirrorAttrs(el: Element): void {
  for (const attr of PROSEMIRROR_ATTRS) {
    el.removeAttribute(attr);
  }

  // Strip any data-* attributes not in our allowlist
  const toRemove: string[] = [];
  for (const attr of el.attributes) {
    if (attr.name.startsWith("data-")) {
      toRemove.push(attr.name);
    }
  }
  toRemove.forEach((attr) => el.removeAttribute(attr));

  for (const child of el.children) {
    stripProseMirrorAttrs(child);
  }
}

/**
 * Validates that a URL is safe for inclusion in email HTML.
 * Rejects javascript:, vbscript:, and data: protocols.
 */
export function isSafeUrl(url: string): boolean {
  try {
    const normalized = url.trim().toLowerCase();
    if (
      normalized.startsWith("javascript:") ||
      normalized.startsWith("vbscript:") ||
      normalized.startsWith("data:")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Main cleanup function.
 *
 * @param rawHtml - The raw HTML string from TipTap's `getHTML()`
 * @returns A clean, email-safe, sanitized HTML string
 */
export function emailSafeCleanup(rawHtml: string): string {
  if (!rawHtml || rawHtml.trim() === "") return "";

  // --- Step 1: Parse into a DOM tree ---
  // We use a template element as a safe sandbox to avoid any side effects
  const template = document.createElement("template");
  template.innerHTML = rawHtml;
  const fragment = template.content;

  // --- Step 2: Strip ProseMirror/TipTap-specific attributes ---
  for (const child of fragment.children) {
    stripProseMirrorAttrs(child);
  }

  // --- Step 3: Convert back to HTML string ---
  const div = document.createElement("div");
  div.appendChild(fragment.cloneNode(true));
  const stripped = div.innerHTML;

  // --- Step 4: Sanitize with DOMPurify using strict email allowlist ---
  const clean = DOMPurify.sanitize(stripped, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: Object.values(ALLOWED_ATTRS).flat(),
    // Disallow any URL with a dangerous scheme
    ALLOWED_URI_REGEXP:
      /^(?:https?|mailto):|^(?!javascript:|vbscript:|data:)/i,
    // Prevent DOM clobbering
    SANITIZE_DOM: true,
    // Keep safe relative links safe
    FORCE_BODY: false,
  });

  return clean;
}

/**
 * Wraps the cleaned email body in a standards-compliant outer shell
 * for clients that require a top-level container (e.g., some Outlook versions).
 *
 * The inline style ensures maximum compatibility:
 * - font-family: safe web-safe font stack
 * - line-height: readable body text
 * - color: ensures text is visible on white background
 */
export function wrapEmailHtml(bodyHtml: string): string {
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #111827;">${bodyHtml}</div>`;
}
