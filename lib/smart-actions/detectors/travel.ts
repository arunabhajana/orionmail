import type { Detector } from '../engine';
import { DetectorSource, EntityType, SmartActionCommand, SmartActionKind, SmartActionPriority, TrustLevel } from '../types';
import { record, safeUrl, textValue } from '../safety';
import { validIsoDate } from '../calendar';

/** Reservation cards require explicit structured booking data, not city names. */
export const TravelDetector: Detector = {
    id: 'travel',
    detect: ctx => ctx.extractedData.entities.flatMap(entity => {
        if (entity.entityType !== EntityType.SchemaOrgObject) return [];
        const data = entity.metadata;
        const type = String(data['@type']).split('/').pop();
        if (!['FlightReservation', 'LodgingReservation', 'TrainReservation'].includes(type || '')) return [];
        const reference = textValue(data.reservationNumber, 60);
        const booking = record(data.reservationFor) ? data.reservationFor : null;
        if (!reference || !booking) return [];
        const facts: Array<{ label: string; value: string }> = [];
        const add = (label: string, value: unknown) => { const text = textValue(value); if (text) facts.push({ label, value: text }); };
        const place = (value: unknown) => record(value) ? textValue(value.iataCode) || textValue(value.name) : textValue(value);
        add('Booking', reference);
        if (type === 'LodgingReservation') {
            add('Property', booking.name); add('Check-in', readableDate(data.checkinTime)); add('Check-out', readableDate(data.checkoutTime));
        } else {
            add(type === 'FlightReservation' ? 'Flight' : 'Train', booking.flightNumber || booking.trainNumber || booking.name);
            add('From', place(booking.departureAirport || booking.departureStation));
            add('To', place(booking.arrivalAirport || booking.arrivalStation));
            add('Departure', readableDate(booking.departureTime)); add('Arrival', readableDate(booking.arrivalTime));
        }
        if (facts.length < 2) return [];
        const url = safeUrl(data.url);
        return [{
            id: `travel:${type}:${reference}`, kind: SmartActionKind.TRAVEL, priority: SmartActionPriority.Medium,
            trustLevel: TrustLevel.Unverified, detectorSource: DetectorSource.RuleBased, confidence: 0.9,
            title: type === 'LodgingReservation' ? 'Stay reservation' : type === 'TrainReservation' ? 'Train reservation' : 'Flight reservation',
            timestamp: ctx.receivedAt, metadata: { facts },
            actions: url ? [{ label: 'View reservation', command: SmartActionCommand.OpenReservation, data: { url: url.href } }] : [],
        }];
    }).slice(0, 2),
};

function readableDate(value: unknown): string | undefined {
    if (typeof value !== 'string' || !validIsoDate(value)) return undefined;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return undefined;
    return value.length === 10 ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
        : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
