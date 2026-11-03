type EventTransport = <T>(name: string, handler: (event: { payload: T }) => void) => Promise<() => void>;

/** Account views can unmount while native listener registration is still pending. */
export function createEventScope(transport: EventTransport) {
    let disposed = false;
    const stops = new Set<() => void>();
    return {
        async listen<T>(name: string, handler: (event: { payload: T }) => void) {
            if (disposed) return () => {};
            const stop = await transport<T>(name, event => { if (!disposed) handler(event); });
            let active = true;
            const release = () => { if (active) { active = false; stops.delete(release); stop(); } };
            if (disposed) release(); else stops.add(release);
            return release;
        },
        dispose() { disposed = true; for (const stop of [...stops]) stop(); },
    };
}
