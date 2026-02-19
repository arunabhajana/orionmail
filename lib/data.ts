
export interface User {
    name: string;
    email: string;
    avatar: string;
}

export interface Email {
    id: string;
    sender: string;
    senderEmail: string;
    subject: string;
    preview: string;
    avatar: string;
    time: string;
    unread: boolean;
    date: string;
    folder: "inbox" | "sent" | "drafts" | "trash";
    tags: string[];
    body: string; // HTML content
    attachments?: { name: string; size: string; type: string }[];
}

export const CURRENT_USER: User = {
    name: "Arunabha Jana",
    email: "arunabhajana@gmail.com",
    // Using a placeholder gradient or initial if image fails, but here's a high-quality placeholder
    avatar: "https://lh3.googleusercontent.com/aida-public/AB6AXuDdiZ7ujUV58y1iBHcNcbPeLlWZ5RH7ErjzTXlEzZ1-7AXIlly7ReiUTLV4rBb5aTg67WXELK_7d2YCaCs5PrHL4YHDas9W5SU6YFEvdzExUvazhF-Fn2hXtfWj-RciAcyhpbiluDPF18G1mbXhLjySXZZ_KAWrXiQ75D-d-1VTPM2r-xruG9rt9YMBnaz_C8d6da2s6B6tP43m9lvbzRVyktdrNeuHDTb9i8qYcoWO5aF7hCrJSQuFtIAgZCZyBBucg6Pg4NRtC-Gd",
};

export const MOCK_EMAILS: Email[] = [
    {
        id: '1',
        sender: 'Elena Ross',
        senderEmail: 'elena.ross@design.com',
        avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80',
        subject: 'Q4 Design Systems Update',
        preview: "Hi Team, I've attached the latest updates for our design system components...",
        time: '10:24 AM',
        date: 'Oct 24, 2023, 10:24 AM',
        unread: true,
        folder: 'inbox',
        tags: ['Work'],
        attachments: [{ name: "Q4_Design_Specs.fig", size: "24.5 MB", type: "Figma" }],
        body: `
        <p>Hi Team,</p>
        <p>I've just finalized the latest updates for our design system components. This quarter we are focusing heavily on "Spatial UI" principles, which includes our new glassmorphism layer styles and refined shadow depths.</p>
        <p>Key highlights in this update:</p>
        <ul>
            <li><strong>New Backdrop Blur Utility:</strong> Standardized 16px and 24px blur variants for sidebar and navigation components.</li>
            <li><strong>Refined Borders:</strong> 1px semi-transparent white borders to simulate light catching on glass edges.</li>
            <li><strong>Accessibility Improvements:</strong> Increased contrast ratios for text overlays on translucent backgrounds.</li>
        </ul>
        <p>I've attached the Figma file with the updated library. Please take a look and provide your feedback by Friday EOD so we can begin the handoff to the engineering team.</p>
        <p>Best regards,<br/><strong>Elena Ross</strong><br/><span class="text-muted-foreground">Lead Product Designer</span></p>
      `
    },
    {
        id: '2',
        sender: 'GitHub',
        senderEmail: 'noreply@github.com',
        avatar: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
        subject: '[v2.4.0] Release Notes: Glassmorphism Support',
        preview: "A new release has been published for the core-ui repository with glassmorphism support...",
        time: '9:15 AM',
        date: 'Oct 24, 2023, 9:15 AM',
        unread: true,
        folder: 'inbox',
        tags: ['Work', 'Dev'],
        body: `
        <p><strong>v2.4.0</strong> has been released to npm.</p>
        <p>This release includes significant updates to the core styling engine, allowing for dynamic backdrop filters and glassmorphism effects out of the box.</p>
        <h3>Changelog</h3>
        <ul>
           <li>Feature: Added <code>.glass</code> utility class.</li>
           <li>Fix: Resolved z-index stacking context issues on modal backdrops.</li>
           <li>Chore: Updated peer dependencies.</li>
        </ul>
        <p>View the full changelog on the repository.</p>
      `
    },
    {
        id: '3',
        sender: 'Marco Valesquez',
        senderEmail: 'marco.v@marketing.com',
        avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80',
        subject: 'Project Timeline Revision',
        preview: "The stakeholder meeting resulted in a few adjustments to our Q4 roadmap. Can we sync?",
        time: 'Yesterday',
        date: 'Oct 23, 2023, 4:30 PM',
        unread: false,
        folder: 'inbox',
        tags: ['Work'],
        body: `
        <p>Hey Arunabha,</p>
        <p>The stakeholder meeting went well, but they requested we pull forward the mobile app redesign by two weeks.</p>
        <p>This means we'll need to adjust our current sprint. Can we sync tomorrow morning at 10 AM to discuss resource allocation?</p>
        <p>Thanks,<br/>Marco</p>
      `
    },
    {
        id: '4',
        sender: 'Dribbble',
        senderEmail: 'digest@dribbble.com',
        avatar: 'https://cdn.dribbble.com/assets/dribbble-ball-icon-4e54c54ee8f8f72d8cf9f9dd525193a654e72ad85875704bb842749fb2a4729f.png',
        subject: 'New Inspiration for you: Minimalist Dashboards',
        preview: "Check out these trending shots in UI/UX Design this week from artists you follow.",
        time: 'Nov 12',
        date: 'Nov 12, 2023, 8:00 AM',
        unread: false,
        folder: 'inbox',
        tags: ['Personal', 'Design'],
        body: `
        <p>Here are your weekly top shots from Dribbble:</p>
        <p>1. <strong>Finance Dashboard</strong> by Oleg Frolov</p>
        <p>2. <strong>Crypto Wallet App</strong> by Aurélien Salomon</p>
        <p>3. <strong>Smart Home Controller</strong> by Cuberto</p>
        <p>Keep creating!</p>
      `
    },
    {
        id: '5',
        sender: 'Linear',
        senderEmail: 'updates@linear.app',
        avatar: 'https://pbs.twimg.com/profile_images/1699757754687594497/c7J84d7I_400x400.jpg',
        subject: 'Cycle 42 Summary',
        preview: "Your team completed 24 issues in Cycle 42. Velocity increased by 15%.",
        time: 'Nov 10',
        date: 'Nov 10, 2023, 9:00 AM',
        unread: false,
        folder: 'inbox',
        tags: ['Work'],
        body: `
        <p><strong>Cycle 42 is complete.</strong></p>
        <p>Great work team! We burned down 24 points this cycle. Our velocity is trending up.</p>
        <p><strong>Completed Issues:</strong></p>
        <ul>
            <li>Fix: Login redirection loop</li>
            <li>Feature: Dark mode toggle</li>
            <li>Chore: Update deps</li>
        </ul>
      `
    }
];
