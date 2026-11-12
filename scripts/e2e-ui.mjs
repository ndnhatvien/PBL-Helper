/**
 * Smoke test end-to-end trên trình duyệt thật (Chrome/Edge headless).
 *
 * Yêu cầu: đã chạy `npm run build` (script npm test:e2e:ui tự chạy build trước).
 * Có thể chỉ định CHROME_PATH nếu trình duyệt không nằm ở vị trí mặc định.
 *
 * Kịch bản: tạo dữ liệu demo → xuất phiếu chấm → sửa điểm trong Excel →
 * nhập lại → chuyển vai trò GVHD A/B rà soát độc lập → xuất lại 2 file nguồn
 * và kiểm tra điểm nằm đúng dòng/MSSV.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { chromium } from "playwright-core";

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const tempDir = mkdtempSync(path.join(os.tmpdir(), "pbl-e2e-"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // server chưa lên
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Không khởi động được Vite preview tại ${url}`);
}

function modifyGraderFile(sourcePath, targetPath, scores) {
  const workbook = XLSX.read(readFileSync(sourcePath), { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
  const headerRow = matrix.findIndex((row) =>
    row.some((cell) => normalizeText(cell) === "studentkey"),
  );
  assert(headerRow >= 0, "File chấm không có header studentKey");
  const headers = matrix[headerRow];
  const mssvCol = headers.findIndex((cell) => normalizeText(cell) === "mssv");
  const scoreCol = headers.findIndex((cell) => normalizeText(cell) === "diem");
  assert(mssvCol >= 0 && scoreCol >= 0, "File chấm thiếu cột MSSV hoặc Điểm");

  const dataRows = matrix
    .slice(headerRow + 1)
    .filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ""))
    .map((row) => [...row]);
  assert(dataRows.length === 6, `Cần 6 sinh viên demo, nhận ${dataRows.length}`);

  for (const row of dataRows) {
    const mssv = String(row[mssvCol] ?? "");
    assert(mssv in scores, `Thiếu điểm test cho ${mssv}`);
    row[scoreCol] = scores[mssv];
  }

  const sheet = XLSX.utils.aoa_to_sheet([...matrix.slice(0, headerRow + 1), ...dataRows]);
  const output = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(output, sheet, sheetName);
  XLSX.writeFile(output, targetPath);
}

function verifyFinalFile(filePath, expectedScores) {
  const workbook = XLSX.read(readFileSync(filePath), { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
  const headerRow = matrix.findIndex((row) =>
    row.some((cell) => normalizeText(cell) === "mssv"),
  );
  assert(headerRow >= 0, `Không thấy header MSSV trong ${filePath}`);
  const headers = matrix[headerRow];
  const mssvCol = headers.findIndex((cell) => normalizeText(cell) === "mssv");
  const scoreCol = headers.findIndex((cell) => normalizeText(cell) === "ck");
  assert(scoreCol >= 0, `Không thấy cột CK trong ${filePath}`);

  for (const [mssv, score] of Object.entries(expectedScores)) {
    const row = matrix.find((candidate) => String(candidate[mssvCol] ?? "") === mssv);
    assert(row, `Không thấy ${mssv} trong ${filePath}`);
    assert(
      row[scoreCol] === score,
      `Điểm ${mssv} sai: nhận ${String(row[scoreCol])}, mong đợi ${score}`,
    );
  }
}

const chromePath = findChrome();
if (!chromePath) {
  throw new Error(
    "Không tìm thấy Chrome/Edge. Đặt biến môi trường CHROME_PATH tới trình duyệt.",
  );
}

const server = spawn(
  process.execPath,
  [
    path.resolve("node_modules/vite/bin/vite.js"),
    "preview",
    "--port",
    String(PORT),
    "--strictPort",
    "--host",
    "127.0.0.1",
  ],
  { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
);
let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

let browser;
try {
  await waitForServer(BASE_URL);
  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      const location = message.location()?.url ?? "";
      if (
        !text.includes("favicon") &&
        !location.includes("favicon") &&
        !text.includes("Failed to load resource: the server responded with a status of 404")
      ) {
        pageErrors.push(`console: ${text} (${location})`);
      }
    }
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Tạo dữ liệu demo" }).click();
  await page.getByRole("heading", { name: /Nhóm PBL01/ }).waitFor();
  assert(
    (await page.getByText("GV Chấm C").count()) > 0,
    "Demo chưa phân công giảng viên chấm C",
  );
  console.log("✓ Tạo dữ liệu demo: 2 file, 6 sinh viên, 3 nhóm, GVHD A/B, GV chấm C");

  await page
    .locator(".main-nav")
    .getByRole("button", { name: /Xuất file chấm/ })
    .click();
  await page.getByRole("heading", { name: "File theo giảng viên" }).waitFor();
  const graderRow = page.getByRole("row", { name: /GV Chấm C/ });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    graderRow.getByRole("button", { name: "Tải file" }).click(),
  ]);
  const graderFile = path.join(tempDir, "phieu_cham.xlsx");
  await download.saveAs(graderFile);
  console.log("✓ Xuất phiếu chấm cho giảng viên C");

  const scores = {
    DEMO001: 8.5,
    DEMO002: 8,
    DEMO003: 7.5,
    DEMO004: 7,
    DEMO005: 8.8,
    DEMO006: 6.5,
  };
  const gradedFile = path.join(tempDir, "phieu_cham_da_nhap.xlsx");
  modifyGraderFile(graderFile, gradedFile, scores);

  await page
    .locator(".main-nav")
    .getByRole("button", { name: /Nhập điểm đã chấm/ })
    .click();
  await page.getByRole("heading", { name: "1. Chọn file đã chấm" }).waitFor();
  await page.locator('input[type="file"]').setInputFiles(gradedFile);
  await page.getByRole("heading", { name: "2. Bản xem trước thay đổi" }).waitFor();
  await page.getByRole("button", { name: "Xác nhận cập nhật 6 điểm" }).click();
  await page.getByRole("heading", { name: "GVHD rà soát điểm" }).waitFor();
  console.log("✓ Nhập lại 6 điểm, xem trước và xác nhận cập nhật");

  await page
    .locator(".role-select select")
    .selectOption({ label: "GVHD/GV: GVHD Nguyễn A" });
  await page.getByRole("heading", { name: /Nhóm PBL01/ }).waitFor();

  const rowA = page.getByRole("row", { name: /DEMO001/ });
  const rowOverride = page.getByRole("row", { name: /DEMO004/ });
  await rowA.getByRole("button", { name: "Duyệt" }).waitFor();
  await rowOverride.getByText("Ngoài phạm vi").waitFor();
  assert(
    (await rowOverride.getByRole("button", { name: "Duyệt" }).count()) === 0,
    "GVHD A không được có nút duyệt sinh viên bị override cho B",
  );
  const scoreText = await rowOverride.textContent();
  assert(scoreText?.includes("7"), "GVHD A không thấy điểm sinh viên của GVHD B");

  await rowA.getByRole("button", { name: "Duyệt" }).click();
  await page
    .getByRole("row", { name: /DEMO001/ })
    .getByText("Đã duyệt")
    .waitFor();
  console.log("✓ GVHD A thấy all_scores, chỉ duyệt được sinh viên không override");

  await page
    .locator(".role-select select")
    .selectOption({ label: "GVHD/GV: GVHD Trần B" });
  const rowOverrideForB = page.getByRole("row", { name: /DEMO004/ });
  await rowOverrideForB.getByRole("button", { name: "Yêu cầu kiểm tra lại" }).waitFor();
  const rowAForB = page.getByRole("row", { name: /DEMO001/ });
  await rowAForB.getByText("Ngoài phạm vi").waitFor();
  assert(
    (await rowAForB.getByRole("button", { name: "Duyệt" }).count()) === 0,
    "GVHD B không được duyệt sinh viên của A",
  );
  await rowOverrideForB.getByRole("button", { name: "Yêu cầu kiểm tra lại" }).click();
  await page
    .getByRole("row", { name: /DEMO004/ })
    .getByText("Cần kiểm tra lại")
    .waitFor();
  console.log("✓ GVHD B thấy all_scores, chỉ rà soát sinh viên override");

  await page
    .locator(".role-select select")
    .selectOption({ label: "GVHD/GV: GVHD Nguyễn A" });
  await page
    .getByRole("row", { name: /DEMO001/ })
    .getByText("Đã duyệt")
    .waitFor();
  const rowOverrideFinal = page.getByRole("row", { name: /DEMO004/ });
  await rowOverrideFinal.getByText("Cần kiểm tra lại").waitFor();
  assert(
    (await rowOverrideFinal.getByRole("button", { name: "Duyệt" }).count()) === 0,
    "Trạng thái/ quyền của sinh viên thứ hai bị ảnh hưởng",
  );
  console.log("✓ Trạng thái hai sinh viên độc lập, GVHD A vẫn thấy điểm cả nhóm");

  await page
    .locator(".main-nav")
    .getByRole("button", { name: /Xuất danh sách cuối/ })
    .click();
  await page.getByRole("button", { name: /Tạo 2 file đầu ra/ }).click();
  await page.getByRole("heading", { name: "File đầu ra đã tạo" }).waitFor();
  const outputFiles = [];
  for (let index = 0; index < 2; index += 1) {
    const item = page.locator(".download-item").nth(index);
    const [fileDownload] = await Promise.all([
      page.waitForEvent("download"),
      item.getByRole("button", { name: "Tải file" }).click(),
    ]);
    const outputPath = path.join(tempDir, `output-${index}.xlsx`);
    await fileDownload.saveAs(outputPath);
    outputFiles.push({ path: outputPath, name: fileDownload.suggestedFilename() });
  }
  assert(outputFiles.length === 2, "Không xuất đủ hai file nguồn");
  assert(
    outputFiles.every((file) => file.name.includes("_da_cap_nhat")),
    "Tên file đầu ra không đúng",
  );

  const fileA = outputFiles.find((file) => file.name.includes("_A_"));
  const fileB = outputFiles.find((file) => file.name.includes("_B_"));
  assert(fileA && fileB, "Không nhận diện được file nguồn A/B");
  verifyFinalFile(fileA.path, {
    DEMO001: 8.5,
    DEMO002: 8,
    DEMO003: 7.5,
  });
  verifyFinalFile(fileB.path, {
    DEMO004: 7,
    DEMO005: 8.8,
    DEMO006: 6.5,
  });
  console.log("✓ Xuất lại đủ 2 file nguồn, điểm về đúng MSSV/dòng, không ghi đè file gốc");

  assert(pageErrors.length === 0, `Có lỗi runtime trên UI: ${pageErrors.join(" | ")}`);
  await browser.close();
  browser = undefined;
  console.log("E2E UI PASS");
  rmSync(tempDir, { recursive: true, force: true });
} catch (error) {
  console.error("E2E UI FAIL:", error);
  console.error("Thư mục file tạm:", tempDir);
  if (serverLog) console.error(serverLog.slice(-4000));
  if (browser) await browser.close();
  process.exitCode = 1;
} finally {
  server.kill();
}
