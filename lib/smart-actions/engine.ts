import { SmartAction, DetectorContext, SmartActionKind, TrustLevel, SmartActionCommand } from './types';
import { safeUrl, meetingUrl, URL_COMMANDS } from './safety';
import { calendarUrl } from './calendar';

export interface Detector { id: string; detect: (ctx: DetectorContext) => SmartAction[]; }
export interface DetectorMetrics { detectorId: string; durationMs: number; actionsProduced: number; }

class SmartActionsEngineClass {
    private detectors: Detector[] = [];
    public metrics: DetectorMetrics[] = [];
    registerDetector(detector: Detector) {
        if (!this.detectors.some(existing => existing.id === detector.id)) this.detectors.push(detector);
    }
    private validate(action: SmartAction): SmartAction | null {
        if (!Number.isFinite(action.confidence) || action.confidence < 0.8 || !action.title.trim()) return null;
        const actions = action.actions.filter(button => {
            if (button.command === SmartActionCommand.CopyOtp) return typeof button.data?.code === 'string' && /^(?:G-)?[A-Za-z0-9]{4,8}$/.test(button.data.code);
            if (button.command === SmartActionCommand.AddToCalendar) return Boolean(calendarUrl(button.data?.event));
            if (!URL_COMMANDS.has(button.command)) return false;
            return Boolean(button.command === SmartActionCommand.JoinMeeting ? meetingUrl(button.data?.url) : safeUrl(button.data?.url));
        });
        return { ...action, trustLevel: TrustLevel.Unverified, actions };
    }
    detect(ctx: DetectorContext): SmartAction[] {
        if (!ctx.extractedData || ctx.extractedData.version < 12 || !Array.isArray(ctx.extractedData.entities)) return [];
        const unique = new Map<string, SmartAction>();
        this.metrics = [];
        for (const detector of this.detectors) {
            const start = performance.now();
            try {
                const actions = detector.detect(ctx).map(action => this.validate(action)).filter((action): action is SmartAction => Boolean(action));
                for (const action of actions) {
                    let key = action.id;
                    if (action.kind === SmartActionKind.OTP) key = `otp:${action.metadata?.code}`;
                    if (action.kind === SmartActionKind.MEETING) {
                        const join = action.actions.find(button => button.command === SmartActionCommand.JoinMeeting)?.data?.url;
                        if (join) key = `meeting:${join}`;
                    }
                    const old = unique.get(key);
                    if (!old || action.confidence > old.confidence) unique.set(key, action);
                }
                this.metrics.push({ detectorId: detector.id, durationMs: performance.now() - start, actionsProduced: actions.length });
            } catch (error) { console.error(`Smart action detector ${detector.id} failed`, error); }
        }
        return [...unique.values()].sort((a, b) => b.priority - a.priority || b.confidence - a.confidence || b.timestamp - a.timestamp).slice(0, 8);
    }
}
export const SmartActionsEngine = new SmartActionsEngineClass();
