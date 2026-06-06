"use client";

import LoginPage from "@/components/LoginPage";
import { useAuth } from "@/components/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [bootError, setBootError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isCheckingLock, setIsCheckingLock] = useState(true);
  const [authFailed, setAuthFailed] = useState(false);

  const triggerLock = () => {
    setAuthFailed(false);
    invoke<boolean>('authenticate_hello', { message: 'Unlock OrionMail' })
      .then(success => {
        if (success) {
          setIsLocked(false);
        } else {
          setAuthFailed(true);
        }
      })
      .catch(e => {
        console.error(e);
        setAuthFailed(true);
      });
  };

  useEffect(() => {
    invoke<any>('get_app_settings')
      .then(settings => {
        if (settings.app_lock_enabled === true) {
          setIsLocked(true);
          triggerLock();
        }
        setIsCheckingLock(false);
      })
      .catch(() => {
        setIsCheckingLock(false);
      });

    invoke<string | null>('get_boot_error').then(err => {
      if (err) setBootError(err);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isCheckingLock && !loading && user && !bootError && !isLocked) {
      router.replace("/inbox");
    }
  }, [user, loading, router, bootError, isLocked, isCheckingLock]);

  if (bootError) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-white dark:bg-black p-8">
        <div className="max-w-md w-full bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-500 flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          </div>
          <h2 className="text-xl font-bold text-red-600 dark:text-red-400 mb-2">Startup Failed</h2>
          <p className="text-sm text-red-600/80 dark:text-red-400/80 mb-6">{bootError}</p>
          <p className="text-xs text-muted-foreground">
            The application local storage failed to initialize. You may need to clear your application data or check your permissions.
          </p>
        </div>
      </div>
    );
  }

  if (isLocked) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-white dark:bg-black p-8">
        <div className="max-w-sm w-full p-8 text-center">
          <div className="w-16 h-16 rounded-3xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">App Locked</h2>
          <p className="text-sm text-muted-foreground mb-8">
            {authFailed ? "Authentication failed. Please try again." : "Use Windows Hello to unlock OrionMail."}
          </p>
          
          <button 
            onClick={triggerLock}
            className="w-full py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
          >
            Unlock App
          </button>
        </div>
      </div>
    );
  }

  if (isCheckingLock || loading || user) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-mesh">
        <div className="animate-pulse text-slate-400 font-medium">Verifying Session...</div>
      </div>
    );
  }

  return (
    <LoginPage />
  );
}
