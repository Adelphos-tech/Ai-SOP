"use client";
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { StudentProfile } from "@/types";
import { createEmptyProfile, createDemoProfile } from "@/lib/defaultProfile";
import { saveProfile, loadProfile, clearProfile } from "@/lib/persistence/storage";

interface ProfileContextType {
  profile: StudentProfile;
  updateProfile: (updater: (prev: StudentProfile) => StudentProfile) => void;
  resetProfile: () => void;
  loadDemoData: () => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  hydrated: boolean;
  studentId: string | null;
  setStudentId: (id: string | null) => void;
  loadFromServer: (id: string) => Promise<void>;
  saveToServer: () => Promise<void>;
  profileSource: "server" | "local" | "empty";
  serverLoading: boolean;
  serverError: string | null;
}

const ProfileContext = createContext<ProfileContextType | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<StudentProfile>(createEmptyProfile);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [hydrated, setHydrated] = useState(false);
  const [studentId, setStudentIdState] = useState<string | null>(null);
  const [profileSource, setProfileSource] = useState<"server" | "local" | "empty">("empty");
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Load on mount: server if studentId in URL, localStorage otherwise
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlStudentId = urlParams.get("studentId");
    if (urlStudentId) {
      setStudentIdState(urlStudentId);
      // Server load will happen in the next effect
      setProfileSource("empty"); // Will be updated after server load
    } else {
      // No studentId — use localStorage as draft (legacy behavior)
      const saved = loadProfile<StudentProfile>();
      if (saved) {
        setProfile(saved);
        setProfileSource("local");
      }
    }
    setHydrated(true);
  }, []);

  // Load from server when studentId changes
  useEffect(() => {
    if (studentId && hydrated) {
      loadFromServer(studentId);
    }
  }, [studentId, hydrated]);

  const loadFromServer = useCallback(async (id: string) => {
    setServerLoading(true);
    setServerError(null);
    try {
      const res = await fetch(`/api/application/profile?studentId=${id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.profile) {
          // Server profile is authoritative — replace local
          setProfile(data.profile as StudentProfile);
          setProfileSource("server");
        } else {
          // No server profile yet — start with empty (NOT localStorage)
          // localStorage may contain unrelated data from a different student
          setProfile(createEmptyProfile());
          setProfileSource("empty");
        }
      } else if (res.status === 404) {
        setServerError("Student not found");
        setProfile(createEmptyProfile());
        setProfileSource("empty");
      } else {
        setServerError("Failed to load profile from server");
        // On server error, keep current profile (don't fall back to localStorage)
      }
    } catch {
      setServerError("Network error loading profile");
      // Keep current profile on network error
    } finally {
      setServerLoading(false);
    }
  }, []);

  const saveToServer = useCallback(async () => {
    if (!studentId) return;
    try {
      const res = await fetch("/api/application/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, profileData: profile }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setServerError(data.error || "Failed to save profile");
        setSaveStatus("error");
      }
    } catch {
      setServerError("Network error saving profile");
      setSaveStatus("error");
    }
  }, [studentId, profile]);

  // Debounced save
  // When studentId exists: save to server (authoritative) + localStorage (draft)
  // When no studentId: save to localStorage only (legacy)
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    // Don't auto-save while server is loading
    if (serverLoading) return;
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (studentId) {
        // Server is authoritative — save to server
        saveToServer();
      }
      // Also save to localStorage as draft backup
      saveProfile(profile);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [profile, hydrated, studentId, saveToServer, serverLoading]);

  const updateProfile = useCallback((updater: (prev: StudentProfile) => StudentProfile) => {
    setProfile(prev => updater(prev));
  }, []);

  const resetProfile = useCallback(() => {
    clearProfile();
    setProfile(createEmptyProfile());
    setProfileSource("empty");
  }, []);

  const loadDemoData = useCallback(() => {
    setProfile(createDemoProfile());
    setProfileSource("local");
  }, []);

  const setStudentId = useCallback((id: string | null) => {
    setStudentIdState(id);
    if (id) {
      setProfileSource("empty"); // Will be updated after server load
    }
  }, []);

  return (
    <ProfileContext.Provider value={{
      profile, updateProfile, resetProfile, loadDemoData, saveStatus, hydrated,
      studentId, setStudentId, loadFromServer, saveToServer,
      profileSource, serverLoading, serverError,
    }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}
