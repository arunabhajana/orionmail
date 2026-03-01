"use client";

import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/components/AuthContext';

interface SectionHeaderProps {
    title: string;
    description: string;
    action?: React.ReactNode;
}

export const SectionHeader = memo(({ title, description, action }: SectionHeaderProps) => (
    <div className="flex items-start justify-between mb-8">
        <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">{title}</h1>
            <p className="text-muted-foreground">{description}</p>
        </div>
        {action}
    </div>
));
SectionHeader.displayName = "SectionHeader";

// Wrap in functional component to use hooks
export const AccountSection = memo(() => {
    const { user } = useAuth();

    // Fallback values if user data is missing
    const userName = user?.name || "User";
    const userEmail = user?.email || "";
    // Display initials if no picture is available
    const initials = userName.split(' ').map(n => n.charAt(0)).join('').substring(0, 2).toUpperCase();

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
        >
            {/* Profile Card */}
            <div className="p-8 rounded-3xl bg-secondary/30 border border-white/20 backdrop-blur-md">
                <div className="flex items-start gap-6">
                    {user?.picture ? (
                        <div
                            className="w-24 h-24 rounded-full bg-cover bg-center border-4 border-white/20 shadow-xl shrink-0"
                            style={{ backgroundImage: `url('${user.picture}')` }}
                        />
                    ) : (
                        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-primary/60 border-4 border-white/20 shadow-xl flex items-center justify-center shrink-0">
                            <span className="text-3xl font-bold text-white shadow-sm">{initials}</span>
                        </div>
                    )}

                    <div className="flex-1 pt-1">
                        <h2 className="text-2xl font-bold text-foreground mb-1">{userName}</h2>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                            <span>Connected via {user?.provider || "Google"}</span>
                            <span>•</span>
                            <span>Pro Plan Member</span>
                        </div>
                        <div className="flex gap-3">
                            <button className="px-4 py-2 bg-white text-black font-medium rounded-lg shadow-sm hover:bg-white/90 transition-colors text-sm">
                                Change Photo
                            </button>
                            <button className="px-4 py-2 bg-red-500/10 text-red-600 font-medium rounded-lg hover:bg-red-500/20 transition-colors text-sm">
                                Remove
                            </button>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-6 mt-8">
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-muted-foreground ml-1">Full Name</label>
                        <input
                            type="text"
                            defaultValue={userName}
                            className="w-full px-4 py-3 rounded-xl bg-white/50 border border-white/20 outline-none focus:ring-2 focus:ring-primary/20 transition-all text-foreground"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-muted-foreground ml-1">Email Address</label>
                        <input
                            type="email"
                            defaultValue={userEmail}
                            readOnly
                            className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/10 outline-none opacity-70 cursor-not-allowed select-none transition-all text-foreground"
                        />
                    </div>
                </div>

                <button className="mt-8 text-primary font-semibold text-sm hover:underline">
                    Change Password
                </button>
            </div>
        </motion.div>
    );
});
AccountSection.displayName = "AccountSection";
