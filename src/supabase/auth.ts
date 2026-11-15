import { useEffect, useState } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import type { UserProfile, UserRole } from "./types";

export const DEFAULT_ADMIN = {
  email: "admin@dut.udn.vn",
  password: "DHBK@54nlb",
  displayName: "Quản trị viên (Admin - DUT)",
  role: "coordinator" as const,
  lecturerName: "Admin",
};

export const LOCAL_USER_KEY = "pbl_auth_local_user";
export const ALL_PROFILES_KEY = "pbl_all_profiles_v1";

/**
 * Kiểm tra email có thuộc tên miền chính thức của trường Bách Khoa - ĐHĐN không
 */
export function isDutEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@dut.udn.vn");
}

export interface AuthState {
  isConfigured: boolean;
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  isLoading: boolean;
  error: string | null;
}

export function getLocalProfiles(): UserProfile[] {
  try {
    const raw = localStorage.getItem(ALL_PROFILES_KEY);
    const list: UserProfile[] = raw ? JSON.parse(raw) : [];
    // Luôn đảm bảo có tài khoản Admin trong danh sách
    if (!list.some((u) => u.email.toLowerCase() === DEFAULT_ADMIN.email.toLowerCase())) {
      list.unshift({
        id: "admin-dut-id",
        email: DEFAULT_ADMIN.email,
        displayName: DEFAULT_ADMIN.displayName,
        role: DEFAULT_ADMIN.role,
        lecturerName: DEFAULT_ADMIN.lecturerName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      localStorage.setItem(ALL_PROFILES_KEY, JSON.stringify(list));
    }
    return list;
  } catch {
    return [];
  }
}

export function saveLocalProfiles(profiles: UserProfile[]): void {
  localStorage.setItem(ALL_PROFILES_KEY, JSON.stringify(profiles));
}

export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (!error && data) {
        return {
          id: data.id,
          email: data.email,
          displayName: data.display_name || data.email,
          role: (data.role as UserRole) || "guest",
          lecturerName: data.lecturer_name || data.display_name || "",
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };
      }
    } catch {
      // Fallback tiếp bên dưới
    }
  }

  // Tra cứu trong local cache
  const list = getLocalProfiles();
  return list.find((u) => u.id === userId) ?? null;
}

export async function signInWithEmail(email: string, password: string) {
  const cleanEmail = email.trim().toLowerCase();
  const isAdminCredentials =
    cleanEmail === DEFAULT_ADMIN.email.toLowerCase() &&
    password === DEFAULT_ADMIN.password;

  if (supabase) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (!error && data?.user) {
        localStorage.removeItem(LOCAL_USER_KEY);
        window.dispatchEvent(new Event("pbl_auth_change"));
        return data;
      }

      if (isAdminCredentials) {
        // Tự động đăng ký admin trên Supabase nếu chưa có
        try {
          const signUpRes = await signUpWithEmail(
            DEFAULT_ADMIN.email,
            DEFAULT_ADMIN.password,
            DEFAULT_ADMIN.displayName,
            "coordinator",
            "Admin",
          );
          if (signUpRes?.user) {
            const loginRes = await supabase.auth.signInWithPassword({
              email: cleanEmail,
              password,
            });
            if (loginRes.data?.user) {
              localStorage.removeItem(LOCAL_USER_KEY);
              window.dispatchEvent(new Event("pbl_auth_change"));
              return loginRes.data;
            }
          }
        } catch {
          // Bỏ qua lỗi đăng ký nếu tài khoản đã tồn tại
        }
      }

      if (error && !isAdminCredentials) throw error;
    } catch (err) {
      if (!isAdminCredentials) throw err;
    }
  }

  // Fallback đăng nhập local cho Admin
  if (isAdminCredentials) {
    const adminUser: UserProfile = {
      id: "admin-dut-id",
      email: DEFAULT_ADMIN.email,
      displayName: DEFAULT_ADMIN.displayName,
      role: DEFAULT_ADMIN.role,
      lecturerName: DEFAULT_ADMIN.lecturerName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(adminUser));
    window.dispatchEvent(new Event("pbl_auth_change"));
    return { user: adminUser as unknown as User, session: null };
  }

  // Fallback đăng nhập local cho các user đã đăng ký offline
  const localList = getLocalProfiles();
  const found = localList.find((u) => u.email.toLowerCase() === cleanEmail);
  if (found) {
    localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(found));
    window.dispatchEvent(new Event("pbl_auth_change"));
    return { user: found as unknown as User, session: null };
  }

  throw new Error("Email hoặc mật khẩu không chính xác.");
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string,
  role: UserRole = "coordinator",
  lecturerName?: string,
) {
  const cleanEmail = email.trim();
  const cleanName = displayName.trim();
  const cleanLecName = lecturerName?.trim() || cleanName;

  // QUY TẮC PHÂN QUYỀN DUT:
  // - Chỉ email đuôi @dut.udn.vn mới được gán vai trò giảng viên / điều phối viên.
  // - Tất cả các domain khác (gmail, yahoo, outlook...) đều chỉ ở vai trò 'guest' (chờ Admin duyệt).
  const isInternal = isDutEmail(cleanEmail);
  const effectiveRole: UserRole = isInternal ? role : "guest";

  if (supabase) {
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          display_name: cleanName,
          role: effectiveRole,
          lecturer_name: cleanLecName,
        },
      },
    });

    if (error) throw error;

    if (data.user) {
      await supabase.from("profiles").upsert({
        id: data.user.id,
        email: cleanEmail,
        display_name: cleanName,
        role: effectiveRole,
        lecturer_name: cleanLecName,
        updated_at: new Date().toISOString(),
      });
    }

    // Lưu vào cache danh sách local
    const localList = getLocalProfiles();
    const existingIdx = localList.findIndex((u) => u.email.toLowerCase() === cleanEmail.toLowerCase());
    const newProfile: UserProfile = {
      id: data.user?.id || `user-${Date.now()}`,
      email: cleanEmail,
      displayName: cleanName,
      role: effectiveRole,
      lecturerName: cleanLecName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (existingIdx >= 0) localList[existingIdx] = newProfile;
    else localList.push(newProfile);
    saveLocalProfiles(localList);

    return { ...data, effectiveRole };
  }

  // Chế độ Offline / Local
  const localList = getLocalProfiles();
  if (localList.some((u) => u.email.toLowerCase() === cleanEmail.toLowerCase())) {
    throw new Error("Email này đã được đăng ký.");
  }

  const newProfile: UserProfile = {
    id: `user-${Date.now()}`,
    email: cleanEmail,
    displayName: cleanName,
    role: effectiveRole,
    lecturerName: cleanLecName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  localList.push(newProfile);
  saveLocalProfiles(localList);

  localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(newProfile));
  window.dispatchEvent(new Event("pbl_auth_change"));

  return { user: newProfile as unknown as User, session: null, effectiveRole };
}

export async function signInWithGoogle() {
  if (!supabase) throw new Error("Chưa cấu hình Supabase.");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin,
    },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  localStorage.removeItem(LOCAL_USER_KEY);
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Bỏ qua lỗi mạng
    }
  }
  window.dispatchEvent(new Event("pbl_auth_change"));
}

export async function resetPassword(email: string) {
  if (!supabase) throw new Error("Chưa cấu hình Supabase.");
  const { data, error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw error;
  return data;
}

function getStoredLocalUser(): UserProfile | null {
  try {
    const raw = localStorage.getItem(LOCAL_USER_KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

/**
 * Lấy toàn bộ danh sách người dùng (dành cho Admin quản lý & phê duyệt)
 */
export async function fetchAllProfiles(): Promise<UserProfile[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && data && data.length > 0) {
        return data.map((d) => ({
          id: d.id,
          email: d.email,
          displayName: d.display_name || d.email,
          role: (d.role as UserRole) || "guest",
          lecturerName: d.lecturer_name || "",
          createdAt: d.created_at,
          updatedAt: d.updated_at,
        }));
      }
    } catch {
      // Fallback
    }
  }

  return getLocalProfiles();
}

/**
 * Admin duyệt vai trò người dùng (chuyển từ guest sang advisor / coordinator / grader)
 */
export async function updateUserProfileRole(
  userId: string,
  newRole: UserRole,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (supabase) {
      const { error } = await supabase
        .from("profiles")
        .update({ role: newRole, updated_at: new Date().toISOString() })
        .eq("id", userId);

      if (error) return { success: false, error: error.message };
    }

    // Cập nhật local cache
    const list = getLocalProfiles();
    const idx = list.findIndex((u) => u.id === userId);
    if (idx >= 0) {
      list[idx].role = newRole;
      list[idx].updatedAt = new Date().toISOString();
      saveLocalProfiles(list);
    }

    const currentLocal = getStoredLocalUser();
    if (currentLocal && currentLocal.id === userId) {
      currentLocal.role = newRole;
      localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(currentLocal));
    }

    window.dispatchEvent(new Event("pbl_auth_change"));
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Lỗi khi cập nhật vai trò.",
    };
  }
}

export function useAuth(): AuthState & {
  refreshProfile: () => Promise<void>;
} {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error] = useState<string | null>(null);

  const isConfigured = isSupabaseConfigured();

  const loadProfile = async (u: User | null) => {
    if (!u) {
      setProfile(null);
      return;
    }
    const prof = await fetchUserProfile(u.id);
    if (prof) {
      setProfile(prof);
    } else {
      setProfile({
        id: u.id,
        email: u.email || "",
        displayName: u.user_metadata?.display_name || u.email || "Người dùng",
        role: (u.user_metadata?.role as UserRole) || (isDutEmail(u.email || "") ? "advisor" : "guest"),
        lecturerName: u.user_metadata?.lecturer_name || u.user_metadata?.display_name || "",
        createdAt: u.created_at,
        updatedAt: u.updated_at || u.created_at,
      });
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      // 1. Kiểm tra session Supabase trước
      if (supabase) {
        try {
          const { data: { session: s } } = await supabase.auth.getSession();
          if (s?.user) {
            setSession(s);
            setUser(s.user);
            await loadProfile(s.user);
            setIsLoading(false);
            return;
          }
        } catch {
          // Fallback tiếp
        }
      }

      // 2. Kiểm tra local user
      const local = getStoredLocalUser();
      if (local) {
        setProfile(local);
        setUser({ id: local.id, email: local.email } as unknown as User);
        setSession(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
    };

    initAuth();

    const handleLocalAuthChange = () => {
      const local = getStoredLocalUser();
      if (local) {
        setProfile(local);
        setUser({ id: local.id, email: local.email } as unknown as User);
      } else if (!supabase) {
        setProfile(null);
        setUser(null);
      }
    };
    window.addEventListener("pbl_auth_change", handleLocalAuthChange);

    let subscription: { unsubscribe: () => void } | null = null;
    if (supabase) {
      const { data } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          await loadProfile(newSession.user);
        } else {
          const local = getStoredLocalUser();
          if (local) {
            setProfile(local);
            setUser({ id: local.id, email: local.email } as unknown as User);
          } else {
            setProfile(null);
          }
        }
        setIsLoading(false);
      });
      subscription = data.subscription;
    }

    return () => {
      window.removeEventListener("pbl_auth_change", handleLocalAuthChange);
      if (subscription) subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = async () => {
    if (user) {
      await loadProfile(user);
    }
  };

  return {
    isConfigured,
    user,
    session,
    profile,
    isLoading,
    error,
    refreshProfile,
  };
}
