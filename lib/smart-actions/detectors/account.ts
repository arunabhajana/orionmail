import {
    DetectorContext,
    SmartAction,
    SmartActionKind,
    SmartActionPriority,
    SmartActionCommand,
    TrustLevel,
    DetectorSource,
} from '../types';
import { Detector } from '../engine';

export const AccountActionDetector: Detector = {
    id: 'account',
    detect: (ctx: DetectorContext): SmartAction[] => {
        const actions: SmartAction[] = [];
        const subj = ctx.subject.toLowerCase();
        
        let isSecurity = false;
        let command = SmartActionCommand.OpenLink;
        let title = 'Account Action';
        
        if (subj.includes('verify') && subj.includes('email')) {
            isSecurity = true;
            command = SmartActionCommand.VerifyAccount;
            title = 'Verify Your Email';
        } else if (subj.includes('reset') && subj.includes('password')) {
            isSecurity = true;
            command = SmartActionCommand.ResetPassword;
            title = 'Password Reset Requested';
        } else if (subj.includes('new sign-in') || subj.includes('new login')) {
            isSecurity = true;
            title = 'New Sign-in Detected';
        }
        
        if (isSecurity) {
            // Find a primary link to act on
            const primaryLink = ctx.extractedData.entities.find(e => e.entityType === 'Link' && e.confidence > 0.8);
            
            actions.push({
                id: `action_account_${ctx.extractedData.extractedAt}`,
                kind: SmartActionKind.SECURITY,
                priority: SmartActionPriority.High,
                trustLevel: TrustLevel.Unverified, // Validator might upgrade it
                detectorSource: DetectorSource.RuleBased,
                title,
                subtitle: 'Please review this security event.',
                confidence: 0.9,
                timestamp: Date.now(),
                actions: [
                    {
                        label: 'Review Activity',
                        command,
                        data: { url: primaryLink?.value || '' },
                        primary: true
                    }
                ]
            });
        }
        
        return actions;
    }
};
