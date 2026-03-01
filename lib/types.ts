export interface Email {
    id: string;
    sender: string;
    senderEmail: string;
    subject: string;
    preview: string;
    date: string;
    time: string;
    unread: boolean;
    starred?: boolean;
    folder: string;
    avatar?: string;
    attachments?: {
        name: string;
        size: string;
        type: string;
    }[];
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
