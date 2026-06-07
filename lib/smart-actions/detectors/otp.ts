import {
    DetectorContext,
    SmartAction,
    SmartActionKind,
    SmartActionPriority,
    SmartActionCommand,
    TrustLevel,
    DetectorSource,
    EntityType
} from '../types';
import { Detector } from '../engine';

export const OtpDetector: Detector = {
    id: 'otp',
    detect: (ctx: DetectorContext): SmartAction[] => {
        const codes = ctx.extractedData.entities.filter(e => e.entityType === EntityType.Code || e.entityType === 'Code');
        
        return codes.map(entity => ({
            id: `action_${entity.id}`,
            kind: SmartActionKind.OTP,
            priority: SmartActionPriority.Critical,
            trustLevel: TrustLevel.Verified, // We consider regex matches verified enough to display
            detectorSource: DetectorSource.RuleBased,
            title: 'Verification Code Detected',
            subtitle: 'We found a code in this email for quick access.',
            confidence: entity.confidence,
            timestamp: Date.now(),
            actions: [
                {
                    label: 'Copy Code',
                    command: SmartActionCommand.CopyOtp,
                    data: { code: entity.value },
                    primary: true
                }
            ]
        }));
    }
};
