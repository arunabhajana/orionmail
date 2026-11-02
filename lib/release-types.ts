export interface Release {
    schemaVersion: number;
    version: string;
    status: 'draft' | 'ready' | 'released';
    sample: boolean;
    date: string | null;
    title: string;
    summary: string;
    sections: { category: 'Added' | 'Improved' | 'Fixed' | 'Known issues'; items: { title: string; text: string }[] }[];
    whatsNew: { id: string; eyebrow: string; title: string; text: string; image: { src: string; alt: string } }[];
}
