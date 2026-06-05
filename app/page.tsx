"use client";

import LoginPage from "@/components/LoginPage";
import { useAuth } from "@/components/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke<string | null>('get_boot_error').then(err => {
        if (err) setBootError(err);
      });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading && user && !bootError) {
      router.replace("/inbox");
    }
  }, [user, loading, router, bootError]);

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

  if (loading || user) {
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
