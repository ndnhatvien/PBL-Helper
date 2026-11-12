import type {
  ExamBatch,
  GroupMember,
  Lecturer,
  PblGroup,
  ScoreConfig,
} from "../types";

export interface AppData {
  version: 1;
  batches: ExamBatch[];
  activeBatchId: string | null;
  currentRole: "coordinator" | "advisor";
  currentLecturerId: string | null;
  sourceWorkbooks: import("../types").SourceWorkbook[];
  students: import("../types").Student[];
  groups: PblGroup[];
  members: GroupMember[];
  lecturers: Lecturer[];
  scores: import("../types").Score[];
  reviews: import("../types").ScoreReview[];
  changeLogs: import("../types").ScoreChangeLog[];
  importRuns: import("../types").ImportRun[];
  conflicts: import("../types").ScoreConflict[];
}

export const STORAGE_KEY = "pbl-grading-review-v1";

export function createEmptyData(): AppData {
  return {
    version: 1,
    batches: [],
    activeBatchId: null,
    currentRole: "coordinator",
    currentLecturerId: null,
    sourceWorkbooks: [],
    students: [],
    groups: [],
    members: [],
    lecturers: [],
    scores: [],
    reviews: [],
    changeLogs: [],
    importRuns: [],
    conflicts: [],
  };
}

const ARRAY_KEYS = [
  "batches",
  "sourceWorkbooks",
  "students",
  "groups",
  "members",
  "lecturers",
  "scores",
  "reviews",
  "changeLogs",
  "importRuns",
  "conflicts",
] as const;

export function loadData(storage: Pick<Storage, "getItem">): AppData {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyData();
    const parsed = JSON.parse(raw) as Partial<AppData>;
    const base = createEmptyData();
    const merged: AppData = {
      ...base,
      ...parsed,
      version: 1,
    };
    for (const key of ARRAY_KEYS) {
      if (!Array.isArray(merged[key])) {
        (merged as unknown as Record<string, unknown[]>)[key] = [];
      }
    }
    return merged;
  } catch {
    return createEmptyData();
  }
}

export function saveData(storage: Pick<Storage, "setItem">, data: AppData): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export interface CreateBatchInput {
  name: string;
  term: string;
  examDate: string;
  note: string;
  scoreConfig: ScoreConfig;
}

export function buildBatch(input: CreateBatchInput, isDemo = false): ExamBatch {
  const now = new Date().toISOString();
  return {
    id: `batch_${crypto.randomUUID()}`,
    name: input.name.trim(),
    term: input.term.trim(),
    examDate: input.examDate,
    note: input.note.trim(),
    scoreConfig: { ...input.scoreConfig },
    status: "active",
    isDemo,
    createdAt: now,
    updatedAt: now,
  };
}
