"use client";

import LoginPage from "@/components/LoginPage";
import { useAuth } from "@/components/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/inbox");
    }
  }, [user, loading, router]);

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
