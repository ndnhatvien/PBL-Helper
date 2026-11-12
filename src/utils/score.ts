import type { ScoreConfig } from "../types";

export function parseScoreValue(
  raw: unknown,
  config: ScoreConfig,
): { value: number | null; error: string | null } {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { value: null, error: "Điểm trống" };
  }

  const text = String(raw).trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    return { value: null, error: `Điểm sai định dạng: "${String(raw)}"` };
  }

  const value = Number(text);
  if (!Number.isFinite(value)) {
    return { value: null, error: `Điểm không hợp lệ: "${String(raw)}"` };
  }
  if (value < config.min || value > config.max) {
    return {
      value: null,
      error: `Điểm ${value} ngoài phạm vi ${config.min}–${config.max}`,
    };
  }

  const decimals = decimalCount(text);
  if (decimals > config.decimals) {
    return {
      value: null,
      error: `Điểm ${text} vượt quá ${config.decimals} chữ số thập phân`,
    };
  }

  return { value, error: null };
}

function decimalCount(text: string): number {
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

export function formatScore(value: number, config: ScoreConfig): string {
  return value.toFixed(config.decimals);
}
