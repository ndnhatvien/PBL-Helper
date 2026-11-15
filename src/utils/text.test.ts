import { describe, expect, it } from "vitest";
import {
  formatAdvisorGroupCode,
  isBarredGroupCode,
  normalizeRawGroupCode,
} from "./text";

describe("normalizeRawGroupCode", () => {
  it("chuẩn hóa nhóm thường thành dạng N##", () => {
    expect(normalizeRawGroupCode("1")).toBe("N01");
    expect(normalizeRawGroupCode("01")).toBe("N01");
    expect(normalizeRawGroupCode("15")).toBe("N15");
    expect(normalizeRawGroupCode("Nhóm 1")).toBe("N01");
    expect(normalizeRawGroupCode("nhom 02")).toBe("N02");
    expect(normalizeRawGroupCode("N1")).toBe("N01");
    expect(normalizeRawGroupCode("N05")).toBe("N05");
  });

  it("chuẩn hóa nhóm cấm thi xxx", () => {
    expect(normalizeRawGroupCode("xxx")).toBe("XXX");
    expect(normalizeRawGroupCode("XXX")).toBe("XXX");
    expect(normalizeRawGroupCode("xxxx")).toBe("XXX");
  });

  it("chuẩn hóa nhóm cấm thi dạng X## (## là số thứ tự)", () => {
    expect(normalizeRawGroupCode("X1")).toBe("X01");
    expect(normalizeRawGroupCode("x1")).toBe("X01");
    expect(normalizeRawGroupCode("X01")).toBe("X01");
    expect(normalizeRawGroupCode("x02")).toBe("X02");
    expect(normalizeRawGroupCode("X12")).toBe("X12");
    expect(normalizeRawGroupCode("Nhóm X01")).toBe("X01");
    expect(normalizeRawGroupCode("nhom x1")).toBe("X01");
    expect(normalizeRawGroupCode("X-01")).toBe("X01");
    expect(normalizeRawGroupCode("x_03")).toBe("X03");
  });
});

describe("isBarredGroupCode", () => {
  it("nhận diện đúng các mã cấm thi dạng xxx", () => {
    expect(isBarredGroupCode("xxx")).toBe(true);
    expect(isBarredGroupCode("XXX")).toBe(true);
    expect(isBarredGroupCode("T.Nam_41_XXX")).toBe(true);
    expect(isBarredGroupCode("T.Nam_41_xxx")).toBe(true);
    expect(isBarredGroupCode("T.Tung_40-xxx")).toBe(true);
    expect(isBarredGroupCode("Nhóm xxx")).toBe(true);
  });

  it("nhận diện đúng các mã cấm thi dạng X##", () => {
    expect(isBarredGroupCode("X01")).toBe(true);
    expect(isBarredGroupCode("X1")).toBe(true);
    expect(isBarredGroupCode("x02")).toBe(true);
    expect(isBarredGroupCode("X15")).toBe(true);
    expect(isBarredGroupCode("T.Nam_41_X01")).toBe(true);
    expect(isBarredGroupCode("T.Nam_41_X1")).toBe(true);
    expect(isBarredGroupCode("T.Tung_T.Thanh_40_X02")).toBe(true);
    expect(isBarredGroupCode("Nhóm X01")).toBe(true);
    expect(isBarredGroupCode("wb_1-X03")).toBe(true);
  });

  it("không nhận nhầm nhóm bình thường hoặc tên giảng viên có chữ x", () => {
    expect(isBarredGroupCode("N01")).toBe(false);
    expect(isBarredGroupCode("T.Nam_41_N01")).toBe(false);
    expect(isBarredGroupCode("T.Xuan_41_N01")).toBe(false);
    expect(isBarredGroupCode("C.Xuyen_40_N02")).toBe(false);
    expect(isBarredGroupCode("PBL01")).toBe(false);
    expect(isBarredGroupCode("21Nh11")).toBe(false);
    expect(isBarredGroupCode("")).toBe(false);
    expect(isBarredGroupCode(null)).toBe(false);
    expect(isBarredGroupCode(undefined)).toBe(false);
  });
});

describe("formatAdvisorGroupCode", () => {
  it("ghép tiền tố với mã nhóm cấm thi dạng X##", () => {
    expect(formatAdvisorGroupCode("T.Nam_41", "X1")).toBe("T.Nam_41_X01");
    expect(formatAdvisorGroupCode("T.Nam_41", "X02")).toBe("T.Nam_41_X02");
    expect(formatAdvisorGroupCode("T.Nam_41", "xxx")).toBe("T.Nam_41_XXX");
  });
});
