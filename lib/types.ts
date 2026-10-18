export interface Attachment {
    partId: string;
    name: string;
    size: string;
    type: string;
}

export interface Email {
    tagsPending?: boolean;
    id: string;
    uid: number;
    uidValidity?: number;
    messageId?: string;
    sender: string;
    senderEmail: string;
    to?: string;
    subject: string;
    preview: string;
    date: string;
    time: string;
    timestamp: number;
    unread: boolean;
    starred: boolean;
    folder: "inbox" | "sent" | "drafts" | "trash" | "starred" | string;
    avatar?: string;
    body?: string;
    tags: string[];
    attachments: Attachment[];
}

export interface NavItemConfig {
    icon: React.ElementType;
    label: string;
    id: string;
    badge?: number;
    highlight?: boolean;
}

export interface Tag {
    account_id: string;
    id: string;
    name: string;
    tag_type: string;
    bg_color?: string | null;
    text_color?: string | null;
    provider: string;
    updated_at: number;
}

export interface SettingsTabConfig {
    id: string;
    label: string;
    icon: React.ElementType;
}

export const GMAIL_TAG_COLORS = [
    // White text pairs
    { bg: '#000000', text: '#ffffff' },
    { bg: '#434343', text: '#ffffff' },
    { bg: '#666666', text: '#ffffff' },
    { bg: '#fb4c2f', text: '#ffffff' },
    { bg: '#ffad47', text: '#ffffff' },
    { bg: '#16a766', text: '#ffffff' },
    { bg: '#4a86e8', text: '#ffffff' },
    { bg: '#a479e2', text: '#ffffff' },
    { bg: '#f691b3', text: '#ffffff' },
    { bg: '#e66550', text: '#ffffff' },
    { bg: '#44b984', text: '#ffffff' },
    { bg: '#6d9eeb', text: '#ffffff' },
    { bg: '#b694e8', text: '#ffffff' },
    { bg: '#cc3a21', text: '#ffffff' },
    { bg: '#eaa041', text: '#ffffff' },
    { bg: '#149e60', text: '#ffffff' },
    { bg: '#3c78d8', text: '#ffffff' },
    // Black text pairs
    { bg: '#cccccc', text: '#000000' },
    { bg: '#efefef', text: '#000000' },
    { bg: '#f3f3f3', text: '#000000' },
    { bg: '#ffffff', text: '#000000' },
    { bg: '#fad165', text: '#000000' },
    { bg: '#43d692', text: '#000000' },
    { bg: '#f6c5be', text: '#000000' },
    { bg: '#ffe6c7', text: '#000000' },
    { bg: '#fef1d1', text: '#000000' },
    { bg: '#b9e4d0', text: '#000000' },
    { bg: '#c6f3de', text: '#000000' },
    { bg: '#c9daf8', text: '#000000' },
    { bg: '#e4d7f5', text: '#000000' },
    { bg: '#fcdee8', text: '#000000' },
    { bg: '#efa093', text: '#000000' },
    { bg: '#ffd6a2', text: '#000000' },
    { bg: '#fce8b3', text: '#000000' },
];
