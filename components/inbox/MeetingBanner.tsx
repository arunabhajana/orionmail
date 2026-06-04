"use client";

import { invoke } from '@tauri-apps/api/core';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Video, 
  Calendar, 
  Users, 
  Globe, 
  Check, 
  Copy, 
  CalendarPlus, 
  ChevronDown, 
  Download,
  ExternalLink,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { MeetingInfo } from '@/hooks/useMeetingDetection';
import { 
  generateGoogleCalendarUrl, 
  generateOutlookCalendarUrl, 
  downloadICS 
} from '@/lib/calendar-utils';

interface MeetingBannerProps {
  meeting: MeetingInfo;
  className?: string;
}

const ProviderIcon = ({ provider, className }: { provider: string, className?: string }) => {
  switch (provider) {
    case 'zoom':
    case 'google_meet':
    case 'webex':
    case 'riverside':
    case 'around':
      return <Video className={className} />;
    case 'teams':
      return <Users className={className} />;
    case 'calendly':
      return <Calendar className={className} />;
    default:
      return <Globe className={className} />;
  }
};

const ProviderName = ({ provider }: { provider: string }) => {
  switch (provider) {
    case 'zoom': return 'Zoom Meeting';
    case 'google_meet': return 'Google Meet';
    case 'teams': return 'Microsoft Teams';
    case 'webex': return 'Webex Meeting';
    case 'calendly': return 'Calendly Event';
    case 'riverside': return 'Riverside Studio';
    case 'around': return 'Around Meeting';
    default: return 'Virtual Meeting';
  }
};

export const MeetingBanner: React.FC<MeetingBannerProps> = ({ meeting, className }) => {
  const [copied, setCopied] = useState(false);
  const [toastPos, setToastPos] = useState<{ x: number, y: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCopy = (e: React.MouseEvent) => {
    navigator.clipboard.writeText(meeting.url);
    setCopied(true);
    
    let x = e.clientX;
    let y = e.clientY + 20;
    
    if (typeof window !== 'undefined') {
      const toastWidth = 180;
      const toastHeight = 40;
      
      if (x + toastWidth / 2 > window.innerWidth - 30) {
        x = window.innerWidth - 30 - toastWidth / 2;
      } else if (x - toastWidth / 2 < 30) {
        x = toastWidth / 2 + 30;
      }
      
      if (y + toastHeight > window.innerHeight - 30) {
        y = e.clientY - 20 - toastHeight;
      }
    }
    
    setToastPos({ x, y });
    
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const showCalendarActions = meeting.confidence !== 'low' && !meeting.isPastMeeting;

  const eventDetails = {
    title: meeting.displayTitle,
    description: `Join meeting: ${meeting.url}`,
    location: meeting.url,
    startTime: meeting.startTime || new Date(),
    endTime: meeting.endTime,
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative overflow-visible mb-6 rounded-2xl border",
        "bg-blue-500/5 dark:bg-blue-500/10",
        "border-blue-500/20 dark:border-blue-500/30",
        "shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.1)]",
        className
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-transparent opacity-50 pointer-events-none rounded-2xl" />
      
      <div className="relative p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        
        {/* Left Side: Icon & Details */}
        <div className="flex items-center gap-4 flex-1 overflow-hidden">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
            <ProviderIcon provider={meeting.provider} className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                <ProviderName provider={meeting.provider} />
              </span>
              {meeting.isPastMeeting && (
                <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase">
                  Past Meeting
                </span>
              )}
            </div>
            
            <h4 className="text-base font-semibold text-foreground dark:text-white/90 truncate">
              {meeting.displayTitle}
            </h4>
            
            {meeting.confidence !== 'low' && meeting.startTime && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground dark:text-white/60 mt-1">
                <Clock className="w-3.5 h-3.5" />
                <span>
                  {format(meeting.startTime, 'EEEE, MMMM d, yyyy • h:mm a')}
                  {meeting.confidence === 'high' && meeting.calendarSource?.extractedTimezone && ` ${meeting.calendarSource.extractedTimezone}`}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Actions */}
        <div className="flex items-center gap-2 shrink-0 self-stretch lg:self-auto flex-wrap">
          
          {/* Calendar Actions */}
          {showCalendarActions && (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="h-10 px-4 rounded-xl flex items-center gap-2 text-sm font-medium bg-white dark:bg-[#1C1C21] border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                <CalendarPlus className="w-4 h-4" />
                <span>Add to Calendar</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-50" />
              </button>

              <AnimatePresence>
                {showDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: 5, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 5, scale: 0.95 }}
                    transition={{ duration: 0.1 }}
                    className="absolute right-0 top-full mt-2 w-48 rounded-xl bg-white dark:bg-[#1C1C21] border border-black/10 dark:border-white/10 shadow-xl overflow-hidden z-50 flex flex-col"
                  >
                    <button
                      className="px-4 py-2.5 text-sm text-foreground hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors text-left"
                      onClick={() => {
                        invoke('open_url', { url: generateGoogleCalendarUrl(eventDetails) });
                        setShowDropdown(false);
                      }}
                    >
                      <Globe className="w-4 h-4 opacity-50" />
                      Google Calendar
                    </button>
                    <button
                      className="px-4 py-2.5 text-sm text-foreground hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors text-left"
                      onClick={() => {
                        invoke('open_url', { url: generateOutlookCalendarUrl(eventDetails) });
                        setShowDropdown(false);
                      }}
                    >
                      <Globe className="w-4 h-4 opacity-50" />
                      Outlook Web
                    </button>
                    <div className="h-px bg-black/5 dark:bg-white/5 my-1" />
                    <button
                      onClick={() => {
                        downloadICS(eventDetails);
                        setShowDropdown(false);
                      }}
                      className="px-4 py-2.5 text-sm text-foreground hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors text-left"
                    >
                      <Download className="w-4 h-4 opacity-50" />
                      Download .ics
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Copy Link */}
          <button
            onClick={handleCopy}
            className={cn(
              "h-10 px-4 rounded-xl flex items-center gap-2 text-sm font-medium transition-all duration-300",
              copied 
                ? "bg-green-500 text-white border border-green-500" 
                : "bg-white dark:bg-[#1C1C21] border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
            )}
            title="Copy meeting link"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span className="hidden sm:inline">{copied ? "Copied" : "Copy Link"}</span>
          </button>

          {/* Join Meeting */}
          <button
            onClick={() => invoke('open_url', { url: meeting.url })}
            className="h-10 px-5 rounded-xl flex items-center gap-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-md transition-colors"
          >
            Join Meeting
            <ExternalLink className="w-4 h-4 opacity-70" />
          </button>
        </div>
      </div>

      {/* Copy Toast Portal */}
      {mounted && createPortal(
        <AnimatePresence>
          {copied && toastPos && (
            <motion.div
              initial={{ opacity: 0, y: -5, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 5, scale: 0.95 }}
              style={{ 
                left: toastPos.x, 
                top: toastPos.y + 20,
                transform: 'translateX(-50%)'
              }}
              className="fixed z-[9999] flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/80 dark:bg-white/90 text-white dark:text-black backdrop-blur-md shadow-lg whitespace-nowrap pointer-events-none"
            >
              <Check className="w-3.5 h-3.5" />
              <span className="text-xs font-semibold tracking-tight">Link copied</span>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </motion.div>
  );
};
