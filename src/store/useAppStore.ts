import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppData } from "./store";
import { createEmptyData, loadData, saveData, STORAGE_KEY } from "./store";

export function useAppStore(): {
  data: AppData;
  setData: Dispatch<SetStateAction<AppData>>;
  resetData: () => void;
  persistError: string | null;
} {
  const [data, setData] = useState<AppData>(() =>
    typeof window === "undefined" ? createEmptyData() : loadData(window.localStorage),
  );
  const [persistError, setPersistError] = useState<string | null>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const ok = saveData(window.localStorage, data);
    if (!ok) {
      setPersistError(
        "Không lưu được dữ liệu vào localStorage (có thể do dung lượng file gốc quá lớn). Dữ liệu chỉ còn trong phiên hiện tại.",
      );
    } else {
      setPersistError(null);
    }
  }, [data]);

  const resetData = useCallback(() => {
    setData(createEmptyData());
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { data, setData, resetData, persistError };
}
