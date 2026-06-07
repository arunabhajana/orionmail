import {
    DetectorContext,
    SmartAction,
    SmartActionKind,
    SmartActionPriority,
    SmartActionButton,
    TrustLevel,
    DetectorSource,
    EntityType
} from '../types';
import { Detector } from '../engine';

const commerceEntityTypes = new Set<string>([
    EntityType.InvoiceReference,
    EntityType.ReceiptReference,
    EntityType.OrderReference,
    EntityType.TransactionReference,
    EntityType.SubscriptionReference,
]);

type CommerceKind = 'purchase' | 'order' | 'invoice' | 'refund' | 'subscription' | 'transaction' | 'receipt';

export const CommerceDetector: Detector = {
    id: 'commerce',
    detect: (ctx: DetectorContext): SmartAction[] => {
        const commerceEntities = ctx.extractedData.entities.filter(entity => {
            const commerceType = entity.metadata?.commerceType;
            return commerceEntityTypes.has(String(entity.entityType)) || typeof commerceType === 'string';
        });

        if (!commerceEntities.length) return [];

        const best = [...commerceEntities].sort((a, b) => b.confidence - a.confidence)[0];
        const metadata = best.metadata || {};
        const commerceType = normalizeCommerceKind(metadata.commerceType, best.entityType);
        const subjectParts = parseSubjectCommerce(ctx.subject);
        const metadataProvider = stringValue(best.provider) || stringValue(metadata.provider);
        const providerConfidence = numberValue(metadata.providerConfidence) || 0;
        const contextProvider = subjectParts.provider || providerFromMessageContext(ctx.subject, ctx.sender);
        const provider = contextProvider && providerConfidence < 0.9
            ? contextProvider
            : metadataProvider || contextProvider || senderName(ctx.sender);
        const merchant = subjectParts.seller || stringValue(metadata.merchant);
        const amount = formatAmount(metadata.amount);
        const status = stringValue(metadata.status);
        const referenceLabel = referenceText(best.entityType, best.value);
        const hasItems = Array.isArray(metadata.items) && metadata.items.length > 0;
        const confidence = scoreWithContext(best.confidence, ctx.subject, ctx.sender, provider);

        if (!amount || confidence < 0.8 || (!referenceLabel && !merchant && !hasItems)) {
            return [];
        }

        return [{
            id: `action_commerce_${commerceType}_${best.value || best.id}`,
            kind: smartActionKindFor(commerceType),
            priority: priorityFor(commerceType),
            trustLevel: provider && (contextProvider || providerConfidence >= 0.9) ? TrustLevel.Verified : TrustLevel.Unverified,
            detectorSource: DetectorSource.RuleBased,
            title: titleFor(commerceType, provider),
            subtitle: [merchant, referenceLabel, amount, status].filter(Boolean).join(' • '),
            confidence,
            timestamp: Date.now(),
            metadata: {
                ...metadata,
                entityId: best.id,
                provider,
                company: provider,
                merchant,
                reference: best.value,
                referenceLabel,
                formattedAmount: amount,
                subject: ctx.subject,
                sender: ctx.sender,
            },
            actions: actionsFor(),
        }];
    }
};

function normalizeCommerceKind(raw: unknown, entityType: string): CommerceKind {
    const value = typeof raw === 'string' ? raw.toLowerCase() : '';
    if (isCommerceKind(value)) return value;

    switch (entityType) {
        case EntityType.InvoiceReference: return 'invoice';
        case EntityType.ReceiptReference: return 'receipt';
        case EntityType.OrderReference: return 'order';
        case EntityType.TransactionReference: return 'transaction';
        case EntityType.SubscriptionReference: return 'subscription';
        default: return 'transaction';
    }
}

function isCommerceKind(value: string): value is CommerceKind {
    return ['purchase', 'order', 'invoice', 'refund', 'subscription', 'transaction', 'receipt'].includes(value);
}

function smartActionKindFor(kind: CommerceKind): SmartActionKind {
    switch (kind) {
        case 'purchase': return SmartActionKind.PURCHASE;
        case 'order': return SmartActionKind.ORDER;
        case 'invoice': return SmartActionKind.INVOICE;
        case 'refund': return SmartActionKind.REFUND;
        case 'subscription': return SmartActionKind.SUBSCRIPTION;
        case 'receipt': return SmartActionKind.PURCHASE;
        case 'transaction': return SmartActionKind.TRANSACTION;
    }
}

function priorityFor(kind: CommerceKind): SmartActionPriority {
    if (kind === 'refund' || kind === 'invoice') return SmartActionPriority.High;
    if (kind === 'subscription' || kind === 'order') return SmartActionPriority.Medium;
    return SmartActionPriority.Low;
}

function titleFor(kind: CommerceKind, provider?: string): string {
    const label = {
        purchase: 'Purchase',
        order: 'Order',
        invoice: 'Invoice',
        refund: 'Refund',
        subscription: 'Subscription',
        transaction: 'Transaction',
        receipt: 'Receipt',
    }[kind];
    return provider ? `${label} from ${provider}` : label;
}

function actionsFor(): SmartActionButton[] {
    return [];
}

function formatAmount(amount: unknown): string | null {
    if (!isRecord(amount) || typeof amount.value !== 'number' || typeof amount.currency !== 'string') return null;
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: amount.currency,
            maximumFractionDigits: 2,
        }).format(amount.value);
    } catch {
        return `${amount.currency} ${amount.value}`;
    }
}

function referenceText(entityType: string, value: string): string | null {
    if (!value || ['purchase', 'order', 'invoice', 'receipt', 'transaction', 'subscription'].includes(value)) return null;
    switch (entityType) {
        case EntityType.InvoiceReference: return `Invoice ${value}`;
        case EntityType.ReceiptReference: return `Receipt ${value}`;
        case EntityType.OrderReference: return `Order ${value}`;
        case EntityType.TransactionReference: return `Transaction ${value}`;
        case EntityType.SubscriptionReference: return `Subscription ${value}`;
        default: return value;
    }
}

function scoreWithContext(confidence: number, subject: string, sender: string, provider?: string): number {
    let score = confidence;
    const context = `${subject} ${sender}`.toLowerCase();
    if (provider && context.includes(provider.toLowerCase())) score += 0.05;
    if (/\b(order|invoice|receipt|payment|subscription|refund|purchase)\b/i.test(subject)) score += 0.05;
    return Math.min(0.95, score);
}

function senderName(sender: string): string | undefined {
    const match = sender.match(/^"?([^"<@]+)"?\s*(?:<.*>)?$/);
    const name = match?.[1]?.trim();
    return name ? cleanCommerceWords(name) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function providerFromMessageContext(subject: string, sender: string): string | undefined {
    const subjectPatterns = [
        /\byour\s+(.+?)\s+(?:order|receipt|invoice|purchase|subscription|transaction|refund)\b/i,
        /\b(?:order|receipt|invoice|purchase|subscription|transaction|refund)\s+from\s+(.+?)(?:\s|$)/i,
    ];

    for (const pattern of subjectPatterns) {
        const match = subject.match(pattern);
        const candidate = match?.[1] ? cleanCommerceWords(match[1]) : undefined;
        if (candidate && isUsableProviderName(candidate)) return candidate;
    }

    const senderCandidate = senderName(sender);
    return senderCandidate && isUsableProviderName(senderCandidate) ? senderCandidate : undefined;
}

function parseSubjectCommerce(subject: string): { provider?: string; seller?: string } {
    const orderFrom = subject.match(/\byour\s+(.+?)\s+order\s+from\s+(.+)$/i);
    if (orderFrom) {
        return {
            provider: cleanCommerceWords(orderFrom[1]),
            seller: cleanCommerceWords(orderFrom[2]),
        };
    }

    const fromProvider = subject.match(/\border\s+from\s+(.+)$/i);
    if (fromProvider) {
        return { provider: cleanCommerceWords(fromProvider[1]) };
    }

    return {};
}

function cleanCommerceWords(value: string): string {
    return value
        .replace(/\b(order|orders|receipt|invoice|purchase|subscription|transaction|refund|support|no.?reply|noreply|mail|team)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isUsableProviderName(value: string): boolean {
    return value.length >= 2 && value.length <= 40 && !/@/.test(value);
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
}
