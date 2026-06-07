import {
    SmartAction,
    DetectorContext,
    SmartActionKind,
    TrustLevel,
    SmartActionCommand
} from './types';

export interface Detector {
    id: string;
    detect: (ctx: DetectorContext) => SmartAction[];
}

export interface DetectorMetrics {
    detectorId: string;
    durationMs: number;
    actionsProduced: number;
}

class SmartActionsEngineClass {
    private detectors: Detector[] = [];
    public metrics: DetectorMetrics[] = [];

    registerDetector(detector: Detector) {
        this.detectors.push(detector);
    }

    private validateAction(action: SmartAction): SmartAction | null {
        // Validation Layer
        // Ensure URLs are safe (no javascript:, data:, etc.)
        for (const btn of action.actions) {
            if (btn.data?.url) {
                try {
                    const url = new URL(btn.data.url);
                    if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'mailto:') {
                        return null; // Reject unsafe protocols entirely
                    }
                    
                    // Domain whitelist for specific trusted actions
                    if (btn.command === SmartActionCommand.JoinMeeting) {
                        const trustedDomains = ['zoom.us', 'meet.google.com', 'teams.microsoft.com', 'webex.com'];
                        if (trustedDomains.some(d => url.hostname.endsWith(d))) {
                            action.trustLevel = TrustLevel.Trusted;
                        } else if (action.trustLevel !== TrustLevel.Trusted) {
                            action.trustLevel = TrustLevel.Unverified;
                        }
                    }
                } catch {
                    return null; // Invalid URL
                }
            }
        }
        return action;
    }

    private aggregateActions(actions: SmartAction[]): SmartAction[] {
        // Deduplicate logic
        // E.g., multiple meetings for the same URL, or same OTP
        const aggregated: SmartAction[] = [];
        const seenKeys = new Set<string>();

        for (const action of actions) {
            let key = action.id;
            
            if (action.kind === SmartActionKind.MEETING) {
                const url = action.actions.find(a => a.command === SmartActionCommand.JoinMeeting)?.data?.url;
                if (url) key = `meeting:${url}`;
            } else if (action.kind === SmartActionKind.OTP) {
                const code = action.actions.find(a => a.command === SmartActionCommand.CopyOtp)?.data?.code;
                if (code) key = `otp:${code}`;
            }

            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                aggregated.push(action);
            } else {
                // We could merge them and upgrade confidence if multiple detectors agree
                const existing = aggregated.find(a => {
                    if (a.kind === SmartActionKind.MEETING) {
                        return a.actions.some(btn => btn.data?.url === action.actions.find(b => b.command === SmartActionCommand.JoinMeeting)?.data?.url);
                    }
                    if (a.kind === SmartActionKind.OTP) {
                        return a.actions.some(btn => btn.data?.code === action.actions.find(b => b.command === SmartActionCommand.CopyOtp)?.data?.code);
                    }
                    return a.id === action.id;
                });
                
                if (existing) {
                    existing.confidence = Math.min(1.0, existing.confidence + action.confidence * 0.5);
                    // Upgrade trust level if applicable
                    if (action.trustLevel === TrustLevel.Trusted || existing.trustLevel === TrustLevel.Trusted) {
                        existing.trustLevel = TrustLevel.Trusted;
                    }
                }
            }
        }
        return aggregated;
    }

    detect(ctx: DetectorContext): SmartAction[] {
        if (!ctx.extractedData || !ctx.extractedData.entities) return [];

        let rawActions: SmartAction[] = [];
        this.metrics = [];

        for (const detector of this.detectors) {
            const start = performance.now();
            try {
                const actions = detector.detect(ctx);
                const validActions = actions.map(a => this.validateAction(a)).filter(a => a !== null) as SmartAction[];
                
                rawActions.push(...validActions);
                
                this.metrics.push({
                    detectorId: detector.id,
                    durationMs: performance.now() - start,
                    actionsProduced: validActions.length,
                });
            } catch (err) {
                console.error(`Detector ${detector.id} failed:`, err);
            }
        }

        const aggregated = this.aggregateActions(rawActions);

        // Sort by Priority > Confidence > Timestamp
        return aggregated.sort((a, b) => {
            if (a.priority !== b.priority) return b.priority - a.priority;
            if (a.confidence !== b.confidence) return b.confidence - a.confidence;
            return b.timestamp - a.timestamp;
        });
    }
}

export const SmartActionsEngine = new SmartActionsEngineClass();
