/** Short local initials; rendering a sender never makes an avatar network request. */
export function mailInitials(name: string): string {
    const words = name.replace(/[<>"']/g, "").trim().split(/[\s@]+/).filter(Boolean);
    return words.length > 1 ? `${Array.from(words[0])[0]}${Array.from(words[words.length - 1])[0]}`.toUpperCase() : Array.from(words[0] || "?").slice(0, 2).join("").toUpperCase();
}
export function contactFromHeader(raw: string): { name: string; email: string } {
    const match = raw.match(/^(.*?)\s*<([^>]+)>/);
    const email = (match?.[2] || (raw.includes("@") ? raw : "")).replace(/[<>]/g, "").trim();
    const name = (match?.[1] || (email ? email.split("@")[0] : raw)).replace(/^["']|["']$/g, "").trim();
    return { name: name || email, email };
}

export function splitHeaderAddresses(raw: string): string[] {
    const values: string[] = [];
    let start = 0, quoted = false, escaped = false, angle = false;
    for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (escaped) { escaped = false; continue; }
        if (c === "\\" && quoted) { escaped = true; continue; }
        if (c === '"') quoted = !quoted;
        if (!quoted) {
            if (c === '<') angle = true;
            if (c === '>') angle = false;
            if (!angle && (c === ',' || c === ';')) { values.push(raw.slice(start, i).trim()); start = i + 1; }
        }
    }
    values.push(raw.slice(start).trim());
    return values.filter(Boolean);
}
