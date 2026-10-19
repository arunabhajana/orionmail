import { DetectorContext, SmartAction, SmartActionKind, SmartActionPriority, SmartActionCommand, TrustLevel, DetectorSource, EntityType } from '../types';
import type { Detector } from '../engine';

export const OtpDetector: Detector = {
    id: 'otp',
    detect: (ctx: DetectorContext): SmartAction[] => {
        const codes = ctx.extractedData.entities.filter(entity => entity.entityType === EntityType.Code
            && entity.confidence >= 0.9 && entity.metadata?.contextual === true
            && /^(?:G-)?[A-Za-z0-9]{4,8}$/.test(entity.value) && /[0-9]/.test(entity.value));
        const values = [...new Set(codes.map(entity => entity.value))];
        if (values.length !== 1) return [];
        const code = values[0];
        const older = ctx.receivedAt > 0 && Date.now() - ctx.receivedAt > 60 * 60 * 1000;
        return [{
            id: `otp:${code}`, kind: SmartActionKind.OTP, priority: SmartActionPriority.Critical,
            trustLevel: TrustLevel.Unverified, detectorSource: DetectorSource.RuleBased,
            title: 'Verification code', subtitle: older ? 'Older email. This code may have expired.' : undefined,
            confidence: codes[0].confidence, timestamp: ctx.receivedAt,
            metadata: { code, older },
            actions: [{ label: 'Copy code', command: SmartActionCommand.CopyOtp, data: { code }, primary: true }],
        }];
    },
};
