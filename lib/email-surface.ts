/** Runs inside the sandboxed message document; no parent DOM access. */
export function conversationSurfaceScript(dark: boolean): string {
    return `
        const applyConversationSurface = () => {
            if (!wrapper || wrapper.querySelector('table,img,svg,video,picture')) return false;
            const elements = [document.documentElement, document.body, wrapper, ...wrapper.querySelectorAll('*')];
            const color = value => {
                const match = value.match(/rgba?\\(([^)]+)\\)/);
                if (!match) return null;
                const parts = match[1].trim().split(/[ ,/]+/).map(value => value.endsWith('%') ? parseFloat(value)*2.55 : Number(value));
                return { neutral: Math.max(...parts.slice(0,3))-Math.min(...parts.slice(0,3)) <= 12, alpha: parts.length > 3 ? parts[3] : 1 };
            };
            const styles = elements.map(element => ({ element, style: getComputedStyle(element) }));
            // Preserve deliberately colored or image-based email layouts.
            if (styles.some(({style}) => {
                const background = color(style.backgroundColor);
                return (background && background.alpha > 0 && !background.neutral) || (style.backgroundImage && style.backgroundImage !== 'none');
            })) return false;
            document.documentElement.classList.add('conversation-surface');
            document.documentElement.style.setProperty('color-scheme', 'only light', 'important');
            document.documentElement.classList.remove('dark-mode');
            document.documentElement.style.setProperty('filter', 'none', 'important');
            for (const {element,style} of styles) {
                const background = color(style.backgroundColor);
                if (!background || background.neutral) {
                    element.style.setProperty('background', 'transparent', 'important');
                    element.style.setProperty('background-color', 'transparent', 'important');
                }
                const foreground = color(style.color);
                if (element.tagName !== 'A' && (!foreground || foreground.neutral)) element.style.setProperty('color', '${dark ? '#e4e4e7' : '#18181b'}', 'important');
            }
            return true;
        };
    `;
}
