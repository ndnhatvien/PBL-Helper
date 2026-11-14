export type ReviewStatus = "pending" | "approved" | "needs_changes";

export type AdvisorSource =
  | "student_override"
  | "group_default"
  | "unassigned";

export interface ScoreConfig {
  min: number;
  max: number;
  decimals: number;
  /** true khi toàn bộ cấu hình là giá trị demo, chưa được người dùng xác nhận. */
  isDemoDefault: boolean;
}

export interface ExamBatch {
  id: string;
  name: string;
  term: string;
  examDate: string;
  note: string;
  scoreConfig: ScoreConfig;
  status: "active" | "archived";
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ColumnMapping {
  /** Index cột (0-based) trong sheet. */
  mssv: number | null;
  name: number | null;
  className: number | null;
  courseCode: number | null;
  courseName: number | null;
  groupCode: number | null;
  advisor: number | null;
  score: number | null;
}

export interface SourceWorkbook {
  id: string;
  batchId: string;
  fileName: string;
  fileSize: number;
  sheetName: string;
  sheetNames: string[];
  headerRow: number;
  dataStartRow: number;
  mapping: ColumnMapping;
  headers: string[];
  originalBase64: string;
  importedAt: string;
  metaCourseCode: string | null;
  metaCourseName: string | null;
  metaLecturerName?: string | null;
  metaLecturerNames?: string[];
  groupPrefix?: string;
  sourceTemplate?: "bang_diem" | "dsts" | "custom";
}

export interface Student {
  id: string;
  batchId: string;
  mssv: string;
  name: string;
  className: string;
  courseCode: string;
  courseName: string;
  groupCodeFromSource: string;
  advisorNameFromSource?: string;
  sourceWorkbookId: string;
  sourceSheetName: string;
  sourceRowNumber: number;
  originalRowData: unknown[];
  importedAt: string;
}

export interface PblGroup {
  id: string;
  batchId: string;
  groupCode: string;
  sourceWorkbookId?: string | null;
  defaultAdvisorId: string | null;
  graderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  id: string;
  groupId: string;
  studentId: string;
  advisorOverrideId: string | null;
}

export interface Lecturer {
  id: string;
  batchId: string;
  displayName: string;
  email: string;
  active: boolean;
  room?: string;
}

export interface Score {
  id: string;
  batchId: string;
  studentId: string;
  value: number;
  graderId: string | null;
  sourceFileName: string;
  updatedAt: string;
}

export interface ScoreReview {
  id: string;
  batchId: string;
  studentId: string;
  reviewerId: string;
  status: ReviewStatus;
  note: string;
  updatedAt: string;
}

export interface ScoreConflict {
  id: string;
  batchId: string;
  studentId: string | null;
  studentKey: string;
  mssv: string;
  studentName: string;
  existingValue: number | null;
  newValue: number | null;
  sourceFileName: string;
  createdAt: string;
  resolved: boolean;
}

export interface ScoreChangeLog {
  id: string;
  batchId: string;
  studentId: string;
  oldValue: number | null;
  newValue: number;
  changedBy: string;
  graderId: string | null;
  sourceFileName: string;
  changedAt: string;
}

export interface ImportRun {
  id: string;
  batchId: string;
  kind: "source" | "graded";
  fileName: string;
  createdAt: string;
  status: "success" | "warning" | "failed";
  validationReport: string[];
}

/** Một dòng dữ liệu đọc được từ sheet, trước khi commit. */
export interface ParsedStudentRow {
  sourceRowNumber: number;
  mssv: string;
  name: string;
  className: string;
  courseCode: string;
  courseName: string;
  groupCode: string;
  advisorName?: string;
  originalRowData: unknown[];
  errors: string[];
  warnings: string[];
}

export interface GroupInspection {
  hasGroupColumn: boolean;
  groupCount: number;
  assignedStudentCount: number;
  missingGroupCount: number;
  singleStudentGroups: string[];
  largeGroups: string[];
}

export interface MssvInspection {
  emptyCount: number;
  duplicateCount: number;
  placeholderCount: number;
  formatIssueCount: number;
}

export interface WorkbookValidationSummary {
  totalRows: number;
  validRowCount: number;
  errorRowCount: number;
  warningRowCount: number;
  mssvIssues: MssvInspection;
  groupInspection: GroupInspection;
  hasRiskOfMisassignment: boolean;
  criticalNotes: string[];
}

export interface PendingWorkbook {
  /** Khóa tạm trên UI, sinh ngẫu nhiên. */
  tempId: string;
  fileName: string;
  fileSize: number;
  originalBase64: string;
  sheetNames: string[];
  sheetName: string;
  headerRow: number;
  dataStartRow: number;
  headers: string[];
  mapping: ColumnMapping;
  rows: ParsedStudentRow[];
  metaCourseCode: string | null;
  metaCourseName: string | null;
  metaLecturerName?: string | null;
  metaLecturerNames?: string[];
  groupPrefix?: string;
  sourceTemplate?: "bang_diem" | "dsts" | "custom";
  errors: string[];
  warnings: string[];
  validation?: WorkbookValidationSummary;
}

export interface GradedRow {
  rowNumber: number;
  studentKey: string;
  mssv: string;
  rawScore: string;
  value: number | null;
  graderName: string;
  errors: string[];
  warnings: string[];
}

export interface GradedFileParse {
  fileName: string;
  batchIdFromFile: string | null;
  graderIdFromFile: string | null;
  graderNameFromFile: string | null;
  roomFromFile?: string | null;
  rows: GradedRow[];
  errors: string[];
  warnings: string[];
}

export type CandidateStatus = "valid" | "unchanged" | "error" | "conflict";

export interface ScoreImportCandidate {
  studentId: string | null;
  studentKey: string;
  mssv: string;
  studentName: string;
  oldValue: number | null;
  newValue: number | null;
  sourceFileName: string;
  rowNumber: number;
  graderName: string;
  graderId: string | null;
  status: CandidateStatus;
  messages: string[];
}

export interface GradedImportPreview {
  files: GradedFileParse[];
  candidates: ScoreImportCandidate[];
  missingByGrader: Array<{ graderName: string; missing: string[] }>;
  errors: string[];
  summary: {
    valid: number;
    unchanged: number;
    conflicts: number;
    errors: number;
    missing: number;
  };
}

export interface FinalExportReport {
  workbookId: string;
  fileName: string;
  outputName: string;
  updatedRows: number;
  missingScores: number;
  issues: string[];
}

export interface ReviewRow {
  student: Student;
  group: PblGroup | null;
  member: GroupMember | null;
  advisorId: string | null;
  advisorName: string;
  advisorSource: AdvisorSource;
  score: number | null;
  review: ScoreReview | null;
  canReview: boolean;
}

export interface GroupView {
  group: PblGroup;
  members: Array<{
    member: GroupMember;
    student: Student;
    advisorId: string | null;
    advisorName: string;
    advisorSource: AdvisorSource;
    score: number | null;
    review: ScoreReview | null;
  }>;
  studentCount: number;
  sizeWarning: string | null;
  missingAdvisorCount: number;
}
