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

export const MeetingDetector: Detector = {
    id: 'meeting',
    detect: (ctx: DetectorContext): SmartAction[] => {
        const actions: SmartAction[] = [];
        
        const meetings = ctx.extractedData.entities.filter(e => 
            e.entityType === EntityType.CalendarEvent || 
            (e.entityType === EntityType.SchemaOrgObject && e.metadata?.['@type'] === 'Event') ||
            (e.entityType === EntityType.Link && (e.value.includes('zoom.us') || e.value.includes('meet.google') || e.value.includes('teams.microsoft.com')))
        );

        if (meetings.length > 1) {
            return actions;
        }

        if (meetings.length === 1) {
            let entity = meetings[0];
            let url = entity.value;
            let title = ctx.subject || 'Virtual Meeting';
            
            if (entity.entityType === EntityType.CalendarEvent) {
                url = entity.metadata?.url || url;
                title = entity.metadata?.summary || title;
            }

            let statusLabel = 'Upcoming';
            const dateStrMatch = title.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/i);
            if (dateStrMatch) {
                const meetingDate = new Date(dateStrMatch[0]);
                if (meetingDate.getTime() < Date.now() - 86400000) {
                    statusLabel = 'Past';
                }
            }
            
            const actionsList: any[] = [
                {
                    label: 'Join Meeting',
                    command: SmartActionCommand.JoinMeeting,
                    data: { url },
                    primary: true
                }
            ];

            if (entity.entityType === EntityType.CalendarEvent || dateStrMatch) {
                actionsList.push({
                    label: 'Add to Calendar',
                    command: SmartActionCommand.AddToCalendar,
                    data: { 
                        event: entity.metadata,
                        title: title,
                        date: dateStrMatch ? dateStrMatch[0] : null
                    }
                });
            }

            actions.push({
                id: `action_${entity.id}`,
                kind: SmartActionKind.MEETING,
                priority: SmartActionPriority.High,
                trustLevel: TrustLevel.Verified,
                detectorSource: DetectorSource.RuleBased,
                title,
                subtitle: `Meeting Status: ${statusLabel}`,
                confidence: entity.confidence,
                timestamp: Date.now(),
                actions: actionsList
            });
        }
        
        return actions;
    }
};
