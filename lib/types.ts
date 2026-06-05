export interface Attachment {
    partId: string;
    name: string;
    size: string;
    type: string;
}

export interface Email {
    id: string;
    uid: number;
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
    folder: "inbox" | "sent" | "drafts" | "trash" | "starred";
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

export interface TagConfig {
    label: string;
    colorClass: string;
}

export interface SettingsTabConfig {
    id: string;
    label: string;
    icon: React.ElementType;
}
