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

export const DeliveryDetector: Detector = {
    id: 'delivery',
    detect: (ctx: DetectorContext): SmartAction[] => {
        const trackingNumbers = ctx.extractedData.entities.filter(e => e.entityType === EntityType.TrackingNumber || e.entityType === 'TrackingNumber');
        
        return trackingNumbers.map(entity => {
            let trackUrl = '';
            if (entity.provider === 'FedEx') trackUrl = `https://www.fedex.com/fedextrack/?trknbr=${entity.value}`;
            else if (entity.provider === 'UPS') trackUrl = `https://www.ups.com/track?tracknum=${entity.value}`;
            else if (entity.provider === 'USPS') trackUrl = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${entity.value}`;
            
            return {
                id: `action_${entity.id}`,
                kind: SmartActionKind.DELIVERY,
                priority: SmartActionPriority.Medium,
                trustLevel: TrustLevel.Verified,
                detectorSource: DetectorSource.RuleBased,
                title: `${entity.provider || 'Package'} Delivery`,
                subtitle: `Tracking #: ${entity.value}`,
                confidence: entity.confidence,
                timestamp: Date.now(),
                actions: [
                    {
                        label: 'Track Package',
                        command: SmartActionCommand.TrackPackage,
                        data: { url: trackUrl || `https://www.google.com/search?q=${entity.value}` },
                        primary: true
                    }
                ]
            };
        });
    }
};
