import { SmartActionKind, SmartActionPriority, SmartActionCommand, TrustLevel, DetectorSource, EntityType } from '../types';
import type { Detector } from '../engine';
import { safeUrl } from '../safety';

export const AccountActionDetector: Detector = {
    id: 'account',
    detect: ctx => {
        const reset = /\breset\b.*\bpassword\b|\bpassword reset\b/i.test(ctx.subject);
        const verify = /\bverify\b.*\b(?:email|account)\b|\b(?:email|account) verification\b/i.test(ctx.subject);
        const signin = /\bnew (?:sign-in|login)\b/i.test(ctx.subject) && !/\bcode\b/i.test(ctx.subject);
        if (!reset && !verify && !signin) return [];
        const purpose = reset ? /reset.*password|change.*password/i : verify ? /verify.*(?:email|account)|confirm.*(?:email|account)/i : /review.*(?:activity|sign-in)|secure.*account/i;
        const matches = ctx.extractedData.entities.filter(entity => entity.entityType === EntityType.Link
            && safeUrl(entity.value) && purpose.test(String(entity.metadata.label || '')));
        const link = matches.length === 1 ? matches[0].value : undefined;
        const command = reset ? SmartActionCommand.ResetPassword : verify ? SmartActionCommand.VerifyAccount : SmartActionCommand.OpenLink;
        return [{ id: 'account:review', kind: SmartActionKind.SECURITY, priority: SmartActionPriority.High,
            trustLevel: TrustLevel.Unverified, detectorSource: DetectorSource.RuleBased,
            title: reset ? 'Password reset' : verify ? 'Email verification' : 'New sign-in',
            subtitle: 'Check the sender before following account links.', confidence: 0.9, timestamp: ctx.receivedAt,
            actions: link ? [{ label: reset ? 'Reset password' : verify ? 'Verify email' : 'Review activity', command, data: { url: link } }] : [],
        }];
    },
};
