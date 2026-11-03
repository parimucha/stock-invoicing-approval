import ExcelJS from "exceljs";
import type {
  ExportModel,
  ExportPresetConfig,
  ExportTicketRow,
  TicketColumnKey,
} from "./invoice-export";

const COLUMN_LABELS: Record<TicketColumnKey, string> = {
  month: "Month",
  country: "Country",
  ticket: "Ticket",
  description: "Description",
  hours: "Hours",
  note: "Note",
  status: "Status",
  parent: "Parent",
  epic: "Epic",
  estimate: "Estimate (h)",
};

type CellValue = string | number | { text: string; hyperlink: string };

function ticketCell(row: ExportTicketRow, key: TicketColumnKey): CellValue {
  switch (key) {
    case "month":
      return row.month;
    case "country":
      return row.groupLabel;
    case "ticket":
      return row.jiraUrl
        ? { text: row.ticketLabel, hyperlink: row.jiraUrl }
        : row.ticketLabel;
    case "description":
      return row.description;
    case "hours":
      return row.hours;
    case "note":
      return row.note;
    case "status":
      return row.status ?? "";
    case "parent":
      return row.parent ?? "";
    case "epic":
      return row.epic ?? "";
    case "estimate":
      return row.estimateHours ?? "";
  }
}

// Excel sheet names: max 31 chars, none of []:*?/\, unique case-insensitively.
function uniqueSheetName(label: string, used: Set<string>): string {
  const base = label.replace(/[[\]:*?\/\\]/g, " ").trim().slice(0, 31) || "Group";
  let name = base;
  for (let n = 2; [...used].some((u) => u.toLowerCase() === name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name);
  return name;
}

function addTicketSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  rows: ExportTicketRow[],
  preset: ExportPresetConfig,
) {
  const ws = workbook.addWorksheet(name);
  ws.addRow(
    preset.ticketColumns.map(
      (k) => preset.columnHeaders?.[k] ?? COLUMN_LABELS[k],
    ),
  );
  ws.getRow(1).font = { bold: true };
  for (const row of rows) {
    ws.addRow(preset.ticketColumns.map((k) => ticketCell(row, k)));
  }

  const hoursIdx = preset.ticketColumns.indexOf("hours");
  if (hoursIdx >= 0) ws.getColumn(hoursIdx + 1).numFmt = "0.00";
}

export function renderWorkbook(
  model: ExportModel,
  preset: ExportPresetConfig,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Proficio";

  if (preset.sheets.tickets) {
    if (preset.sheets.perGroup) {
      const used = new Set(["Overview"]);
      for (const g of model.overview.groups) {
        const rows = model.ticketRows.filter((r) => r.groupKey === g.key);
        if (rows.length === 0) continue;
        addTicketSheet(workbook, uniqueSheetName(g.label, used), rows, preset);
      }
    } else {
      addTicketSheet(workbook, "Tickets", model.ticketRows, preset);
    }
  }

  if (preset.sheets.overview) {
    const ws = workbook.addWorksheet("Overview");
    const groups = model.overview.groups;
    const rate = model.overview.eurRate;

    // Row 1: header — blank corner, group labels, Total.
    ws.addRow(["", ...groups.map((g) => g.label), "Total"]);
    ws.getRow(1).font = { bold: true };

    // Row 2: hours per group + total.
    ws.addRow(["Hours", ...groups.map((g) => g.hours), model.overview.totalHours]);

    const lastCol = groups.length + 2; // A + one per group + Total
    for (let col = 2; col <= lastCol; col++) {
      ws.getCell(2, col).numFmt = "0.00";
    }

    // Row 3: CZK (only when the report has a rate).
    const hasCzk = model.overview.totalCzk != null;
    if (hasCzk) {
      ws.addRow([
        "Invoicing CZK",
        ...groups.map((g) => g.czk ?? 0),
        model.overview.totalCzk ?? 0,
      ]);
      for (let col = 2; col <= lastCol; col++) {
        ws.getCell(3, col).numFmt = "#,##0";
      }
    }

    // Row 4: EUR as a live formula referencing the CZK cell, so the client can
    // retune the rate in the file — but only when there is a CZK row and a rate.
    if (hasCzk && rate != null) {
      const czkRowNum = 3;
      const eurRowNum = ws.addRow(["App price EUR"]).number;
      for (let col = 2; col <= lastCol; col++) {
        const czkCell = ws.getCell(czkRowNum, col);
        const result =
          typeof czkCell.value === "number" ? czkCell.value / rate : undefined;
        ws.getCell(eurRowNum, col).value = {
          formula: `${czkCell.address}/${rate}`,
          result,
        };
        ws.getCell(eurRowNum, col).numFmt = "#,##0.00";
      }
    }

    if (model.excludedHours > 0) {
      const exRow = ws.addRow(["Excluded (ungrouped) hours", model.excludedHours]);
      ws.getCell(exRow.number, 2).numFmt = "0.00";
    }

    ws.getColumn(1).width = 16;
  }

  return workbook;
}
