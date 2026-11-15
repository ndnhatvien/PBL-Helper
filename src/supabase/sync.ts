import { supabase } from "./supabaseClient";
import type { AppData } from "../store/store";
import type { ExamBatch } from "../types";
import type { PblBatchPayload, SupabaseBatchRecord } from "./types";

/**
 * Tải toàn bộ danh sách đợt thi và dữ liệu từ Supabase về định dạng AppData
 */
export async function fetchAppDataFromSupabase(): Promise<{
  data: Partial<AppData> | null;
  error?: string;
}> {
  if (!supabase) return { data: null, error: "Chưa cấu hình Supabase." };

  try {
    const { data: records, error } = await supabase
      .from("pbl_batches")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      return { data: null, error: error.message };
    }

    if (!records || records.length === 0) {
      return { data: { batches: [] } };
    }

    const batches: ExamBatch[] = [];
    const sourceWorkbooks: AppData["sourceWorkbooks"] = [];
    const students: AppData["students"] = [];
    const groups: AppData["groups"] = [];
    const members: AppData["members"] = [];
    const lecturers: AppData["lecturers"] = [];
    const scores: AppData["scores"] = [];
    const reviews: AppData["reviews"] = [];
    const changeLogs: AppData["changeLogs"] = [];
    const importRuns: AppData["importRuns"] = [];
    const conflicts: AppData["conflicts"] = [];

    for (const raw of records as SupabaseBatchRecord[]) {
      batches.push({
        id: raw.id,
        name: raw.name,
        term: raw.term || "",
        examDate: raw.exam_date || "",
        note: raw.note || "",
        scoreConfig: raw.score_config || { min: 0, max: 10, decimals: 1, isDemoDefault: false },
        status: (raw.status as "active" | "archived") || "active",
        isDemo: Boolean(raw.is_demo),
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
      });

      const p: PblBatchPayload = raw.payload || {};
      if (Array.isArray(p.sourceWorkbooks)) sourceWorkbooks.push(...p.sourceWorkbooks);
      if (Array.isArray(p.students)) students.push(...p.students);
      if (Array.isArray(p.groups)) groups.push(...p.groups);
      if (Array.isArray(p.members)) members.push(...p.members);
      if (Array.isArray(p.lecturers)) lecturers.push(...p.lecturers);
      if (Array.isArray(p.scores)) scores.push(...p.scores);
      if (Array.isArray(p.reviews)) reviews.push(...p.reviews);
      if (Array.isArray(p.changeLogs)) changeLogs.push(...p.changeLogs);
      if (Array.isArray(p.importRuns)) importRuns.push(...p.importRuns);
      if (Array.isArray(p.conflicts)) conflicts.push(...p.conflicts);
    }

    return {
      data: {
        batches,
        sourceWorkbooks,
        students,
        groups,
        members,
        lecturers,
        scores,
        reviews,
        changeLogs,
        importRuns,
        conflicts,
      },
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Lỗi không xác định khi tải dữ liệu.",
    };
  }
}

/**
 * Lưu 1 đợt thi cụ thể lên Supabase
 */
export async function saveBatchToSupabase(
  data: AppData,
  batchId: string,
  userId?: string | null,
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: "Chưa cấu hình Supabase." };

  const batch = data.batches.find((b) => b.id === batchId);
  if (!batch) return { success: false, error: "Không tìm thấy đợt thi cần lưu." };

  try {
    const batchGroupIds = new Set(
      data.groups.filter((g) => g.batchId === batchId).map((g) => g.id),
    );

    const payload: PblBatchPayload = {
      sourceWorkbooks: data.sourceWorkbooks.filter((w) => w.batchId === batchId),
      students: data.students.filter((s) => s.batchId === batchId),
      groups: data.groups.filter((g) => g.batchId === batchId),
      members: data.members.filter((m) => batchGroupIds.has(m.groupId)),
      lecturers: data.lecturers.filter((l) => l.batchId === batchId),
      scores: data.scores.filter((s) => s.batchId === batchId),
      reviews: data.reviews.filter((r) => r.batchId === batchId),
      changeLogs: data.changeLogs.filter((c) => c.batchId === batchId),
      importRuns: data.importRuns.filter((i) => i.batchId === batchId),
      conflicts: data.conflicts.filter((c) => c.batchId === batchId),
    };

    const record: Partial<SupabaseBatchRecord> = {
      id: batch.id,
      name: batch.name,
      term: batch.term,
      exam_date: batch.examDate,
      note: batch.note,
      score_config: batch.scoreConfig,
      status: batch.status,
      is_demo: Boolean(batch.isDemo),
      payload,
      updated_at: new Date().toISOString(),
    };

    if (userId) {
      record.updated_by = userId;
    }

    const { error } = await supabase.from("pbl_batches").upsert(record);
    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Lỗi lưu dữ liệu lên Supabase.",
    };
  }
}

/**
 * Xóa 1 đợt thi khỏi Supabase
 */
export async function deleteBatchFromSupabase(
  batchId: string,
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: "Chưa cấu hình Supabase." };

  try {
    const { error } = await supabase.from("pbl_batches").delete().eq("id", batchId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Lỗi xóa đợt thi khỏi Supabase.",
    };
  }
}

/**
 * Đồng bộ toàn bộ dữ liệu localStorage hiện tại lên Supabase (migration một lần)
 */
export async function syncLocalDataToSupabase(
  data: AppData,
  userId?: string | null,
): Promise<{ successCount: number; error?: string }> {
  if (!supabase) return { successCount: 0, error: "Chưa cấu hình Supabase." };

  let count = 0;
  for (const b of data.batches) {
    const res = await saveBatchToSupabase(data, b.id, userId);
    if (res.success) {
      count += 1;
    }
  }

  return { successCount: count };
}
