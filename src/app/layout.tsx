import type { Metadata } from "next";
import "./globals.css";
import { ProfileProvider } from "@/lib/persistence/ProfileContext";
import { AppShell } from "@/components/layout/AppShell";
import { AuthGuard } from "@/components/auth/AuthGuard";

export const metadata: Metadata = {
  title: "D-Vivid SOP Portal",
  description: "D-Vivid SOP Student Intake Portal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ProfileProvider>
          <AuthGuard>
            <AppShell>{children}</AppShell>
          </AuthGuard>
        </ProfileProvider>
      </body>
    </html>
  );
}
