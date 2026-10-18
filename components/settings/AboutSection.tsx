"use client";
import Image from "next/image";
import { Inbox, ShieldCheck, Sparkles, Mail, ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import packageInfo from "@/package.json";
import { SettingGroup, SettingRow, settingButton } from "./SettingsControls";
export function AboutSection() {
    return <div className="space-y-5">
        <div data-setting-id="about.version" className="settings-group relative overflow-hidden p-8 sm:p-10"><div className="pointer-events-none absolute -top-20 -right-16 size-72 rounded-full bg-primary/10 blur-3xl" /><div className="relative flex flex-col items-start gap-5"><Image src="/logo.svg" alt="OrionMail" width={72} height={72} unoptimized className="drop-shadow-lg" /><div><h2 className="text-3xl font-semibold tracking-tight">OrionMail</h2><p className="mt-2 text-sm text-muted-foreground">A quieter space for your inbox.</p></div><span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary">Version {packageInfo.version} · Preview</span></div></div>
        <div className="grid gap-3 sm:grid-cols-3">{[{ icon: Inbox, title: "Mail, at your pace", detail: "Local caching and a focused reading experience." }, { icon: Sparkles, title: "A little more useful", detail: "Quick actions for codes, meetings, orders, and travel." }, { icon: ShieldCheck, title: "Thoughtful controls", detail: "Windows Hello and remote-content preferences." }].map(feature => <div key={feature.title} className="settings-group p-5"><feature.icon className="mb-4 size-5 text-primary" /><h3 className="text-sm font-medium">{feature.title}</h3><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{feature.detail}</p></div>)}</div>
        <SettingGroup title="Made with care"><SettingRow id="about.developer" title="Developed by Arunabhajana" description="An independent desktop email app, built around a calmer everyday workflow." /><SettingRow id="about.support" title="Get in touch" description="Feedback and support: arunabhajana@gmail.com"><button className={settingButton} onClick={() => invoke("open_url", { url: "mailto:arunabhajana@gmail.com" }).catch(() => toast.error("Could not open your mail app."))}><Mail className="size-3.5" />Contact<ExternalLink className="size-3" /></button></SettingRow><SettingRow id="about.changelog" title="Release notes" description="Published release notes will be linked when releases are available." unavailable /><SettingRow id="about.privacy" title="Privacy policy and licenses" description="OrionMail’s public privacy policy and third-party notices are not published yet." unavailable /></SettingGroup>
    </div>;
}
