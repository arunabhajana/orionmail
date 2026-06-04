import { useMemo } from 'react';

export function useOtpDetection(htmlBody: string | undefined | null): string | null {
    return useMemo(() => {
        if (!htmlBody) return null;

        // 1. Strip HTML tags to get raw text, replacing tags with spaces
        let text = htmlBody.replace(/<[^>]*>?/gm, ' ');

        // 2. Normalize whitespace (remove zero-width spaces, normalize spaces)
        text = text.replace(/[\u200B-\u200D\uFEFF]/g, '');
        text = text.replace(/\s+/g, ' ');

        // 3. Define patterns
        const patterns = [
            // Standard "G-123456" Google codes
            /\b(G-\d{4,8})\b/i,
            
            // "code: 123456", "otp is 123456", etc.
            /\b(?:code|otp|pin|verification)\b(?:\s+is)?\s*:?-?\s*([A-Z0-9]{4,8})\b/i,
            
            // "123456 is your code"
            /\b([A-Z0-9]{4,8})\b(?=\s+(?:is your|is the)\s+(?:code|otp|pin|verification)\b)/i,
            
            // Loose fallback: keyword nearby within 40 characters
            /\b(?:code|otp|pin|verification)\b(?:.{0,40}?)\b([A-Z0-9]{4,8})\b/i
        ];

        for (const p of patterns) {
            const match = text.match(p);
            if (match && match[1]) {
                const code = match[1];
                // Ensure the extracted code contains at least one digit to avoid matching random words
                if (/\d/.test(code)) {
                    return code.toUpperCase();
                }
            }
        }

        return null;
    }, [htmlBody]);
}
