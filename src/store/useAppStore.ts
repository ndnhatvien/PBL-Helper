import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppData } from "./store";
import { createEmptyData, loadData, saveData, STORAGE_KEY } from "./store";
import { isSupabaseConfigured } from "../supabase/supabaseClient";
import {
  fetchAppDataFromSupabase,
  saveBatchToSupabase,
  syncLocalDataToSupabase,
} from "../supabase/sync";

export function useAppStore(userId?: string | null): {
  data: AppData;
  setData: Dispatch<SetStateAction<AppData>>;
  resetData: () => void;
  persistError: string | null;
  isCloudConfigured: boolean;
  isCloudSyncing: boolean;
  reloadFromCloud: () => Promise<void>;
  syncAllToCloud: () => Promise<{ successCount: number; error?: string }>;
} {
  const [data, setData] = useState<AppData>(() =>
    typeof window === "undefined" ? createEmptyData() : loadData(window.localStorage),
  );
  const [persistError, setPersistError] = useState<string | null>(null);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const isCloudConfigured = isSupabaseConfigured();

  const firstRun = useRef(true);
  const saveTimeoutRef = useRef<number | null>(null);

  // 1. Lưu vào localStorage mỗi khi data thay đổi (luôn giữ bản sao offline)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const ok = saveData(window.localStorage, data);
    if (!ok) {
      setPersistError(
        "Không lưu được dữ liệu vào localStorage (có thể do dung lượng file gốc quá lớn).",
      );
    } else {
      setPersistError(null);
    }
  }, [data]);

  // 2. Tự động đồng bộ lên Supabase nếu có activeBatchId và đã đăng nhập
  useEffect(() => {
    if (!isCloudConfigured || !data.activeBatchId) return;

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(async () => {
      setIsCloudSyncing(true);
      try {
        await saveBatchToSupabase(data, data.activeBatchId!, userId);
      } catch (err) {
        console.error("Lỗi đồng bộ Supabase:", err);
      } finally {
        setIsCloudSyncing(false);
      }
    }, 1500); // Debounce 1.5s để tránh spam request liên tục

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [data, isCloudConfigured, userId]);

  // 3. Hàm tải lại dữ liệu mới nhất từ Cloud
  const reloadFromCloud = useCallback(async () => {
    if (!isCloudConfigured) return;
    setIsCloudSyncing(true);
    try {
      const res = await fetchAppDataFromSupabase();
      if (res.data && res.data.batches && res.data.batches.length > 0) {
        setData((prev) => ({
          ...prev,
          ...res.data,
          activeBatchId: prev.activeBatchId || res.data!.batches![0].id,
        }));
      }
    } finally {
      setIsCloudSyncing(false);
    }
  }, [isCloudConfigured]);

  // 4. Đồng bộ toàn bộ dữ liệu máy hiện tại lên Cloud
  const syncAllToCloud = useCallback(async () => {
    if (!isCloudConfigured) return { successCount: 0, error: "Chưa cấu hình Supabase." };
    setIsCloudSyncing(true);
    try {
      const res = await syncLocalDataToSupabase(data, userId);
      return res;
    } finally {
      setIsCloudSyncing(false);
    }
  }, [data, isCloudConfigured, userId]);

  const resetData = useCallback(() => {
    setData(createEmptyData());
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    data,
    setData,
    resetData,
    persistError,
    isCloudConfigured,
    isCloudSyncing,
    reloadFromCloud,
    syncAllToCloud,
  };
}
