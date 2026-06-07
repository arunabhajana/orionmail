export enum SmartActionPriority {
    Critical = 100,
    High = 75,
    Medium = 50,
    Low = 25,
}

export enum SmartActionKind {
    OTP = 'OTP',
    MEETING = 'MEETING',
    DELIVERY = 'DELIVERY',
    PAYMENT = 'PAYMENT',
    PURCHASE = 'PURCHASE',
    ORDER = 'ORDER',
    INVOICE = 'INVOICE',
    REFUND = 'REFUND',
    SUBSCRIPTION = 'SUBSCRIPTION',
    TRANSACTION = 'TRANSACTION',
    TRAVEL = 'TRAVEL',
    SECURITY = 'SECURITY',
}

export enum SmartActionCommand {
    CopyOtp = 'CopyOtp',
    JoinMeeting = 'JoinMeeting',
    TrackPackage = 'TrackPackage',
    ViewReceipt = 'ViewReceipt',
    ViewInvoice = 'ViewInvoice',
    TrackOrder = 'TrackOrder',
    ViewTransaction = 'ViewTransaction',
    ManageSubscription = 'ManageSubscription',
    OpenReservation = 'OpenReservation',
    AddToCalendar = 'AddToCalendar',
    VerifyAccount = 'VerifyAccount',
    ResetPassword = 'ResetPassword',
    OpenLink = 'OpenLink',
}

export enum TrustLevel {
    Trusted = 'Trusted',
    Verified = 'Verified',
    Unverified = 'Unverified',
}

export enum DetectorSource {
    RuleBased = 'RuleBased',
    AiAssisted = 'AiAssisted',
}

export enum ExtractionSource {
    SchemaOrg = 'SchemaOrg',
    Calendar = 'Calendar',
    Html = 'Html',
    PlainText = 'PlainText',
    Regex = 'Regex',
}

export enum EntityType {
    Code = 'Code',
    Link = 'Link',
    CalendarEvent = 'CalendarEvent',
    TrackingNumber = 'TrackingNumber',
    InvoiceReference = 'InvoiceReference',
    ReceiptReference = 'ReceiptReference',
    OrderReference = 'OrderReference',
    TransactionReference = 'TransactionReference',
    SubscriptionReference = 'SubscriptionReference',
    SchemaOrgObject = 'SchemaOrgObject',
}

export interface Provenance {
    source: ExtractionSource | string;
    extractor: string;
}

export interface ExtractedEntity {
    id: string;
    entityType: EntityType | string;
    provider?: string;
    value: string;
    confidence: number;
    provenance: Provenance;
    evidence?: string;
    metadata: Record<string, unknown>;
}

export interface ExtractedData {
    version: number;
    extractedAt: number;
    entities: ExtractedEntity[];
}

export interface DetectorContext {
    extractedData: ExtractedData;
    receivedAt: number;
    subject: string;
    sender: string;
}

export interface SmartActionButton {
    label: string;
    command: SmartActionCommand;
    data?: Record<string, unknown>;
    primary?: boolean;
}

export interface SmartAction {
    id: string;
    kind: SmartActionKind;
    priority: SmartActionPriority;
    trustLevel: TrustLevel;
    detectorSource: DetectorSource;
    title: string;
    subtitle?: string;
    actions: SmartActionButton[];
    metadata?: Record<string, unknown>;
    confidence: number;
    timestamp: number;
}
