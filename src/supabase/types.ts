import type { AppData } from "../store/store";
import type { ExamBatch } from "../types";

export type UserRole = "coordinator" | "advisor" | "grader" | "guest";

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  lecturerName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PblBatchPayload {
  sourceWorkbooks: AppData["sourceWorkbooks"];
  students: AppData["students"];
  groups: AppData["groups"];
  members: AppData["members"];
  lecturers: AppData["lecturers"];
  scores: AppData["scores"];
  reviews: AppData["reviews"];
  changeLogs: AppData["changeLogs"];
  importRuns: AppData["importRuns"];
  conflicts: AppData["conflicts"];
}

export interface SupabaseBatchRecord {
  id: string;
  name: string;
  term: string;
  exam_date: string;
  note: string;
  score_config: ExamBatch["scoreConfig"];
  status?: "active" | "archived";
  is_demo: boolean;
  created_by?: string | null;
  updated_by?: string | null;
  payload: PblBatchPayload;
  created_at: string;
  updated_at: string;
}
