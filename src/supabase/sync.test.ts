import { describe, expect, it } from "vitest";
import { createDemoData } from "../demo";
import { createEmptyData } from "../store/store";
import type { PblBatchPayload } from "./types";

describe("supabase sync payload logic", () => {
  it("chuẩn bị payload đồng bộ cho đợt thi", () => {
    const demo = createDemoData(createEmptyData());
    expect(demo.error).toBeUndefined();
    const data = demo.data;
    const batchId = data.batches[0].id;

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

    expect(payload.sourceWorkbooks.length).toBeGreaterThan(0);
    expect(payload.students.length).toBeGreaterThan(0);
    expect(payload.groups.length).toBeGreaterThan(0);
    expect(payload.lecturers.length).toBeGreaterThan(0);
  });
});
