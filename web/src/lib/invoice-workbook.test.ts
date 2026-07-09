import { describe, it, expect } from "vitest";
import { renderWorkbook } from "./invoice-workbook";
import type { ExportModel, ExportPresetConfig } from "./invoice-export";

const preset: ExportPresetConfig = {
  columnGroups: [
    { key: "FR", label: "FR", projectIds: ["french_pimcore"] },
    { key: "GER", label: "GER", projectIds: ["german_pimcore"] },
  ],
  ticketColumns: ["month", "country", "ticket", "description", "hours", "note"],
  sheets: { tickets: true, overview: true },
  eurRate: 24.2,
};

function sampleModel(): ExportModel {
  return {
    monthNumber: 5,
    ticketRows: [
      {
        groupKey: "FR",
        groupLabel: "FR",
        month: 5,
        ticketLabel: "SAPS-1",
        jiraUrl: "https://x.atlassian.net/browse/SAPS-1",
        description: "Do a thing",
        hours: 7,
        note: "",
        status: null,
        parent: null,
        estimateHours: null,
        sortMinutes: 420,
      },
      {
        groupKey: "FR",
        groupLabel: "FR",
        month: 5,
        ticketLabel: "PM",
        jiraUrl: null,
        description: "",
        hours: 1.15,
        note: "Weekly status",
        status: null,
        parent: null,
        estimateHours: null,
        sortMinutes: 69,
      },
    ],
    overview: {
      groups: [
        { key: "FR", label: "FR", hours: 8.15, czk: 8150 },
        { key: "GER", label: "GER", hours: 0, czk: 0 },
      ],
      totalHours: 8.15,
      totalCzk: 8150,
      eurRate: 24.2,
    },
    excludedHours: 0,
  };
}

describe("renderWorkbook", () => {
  it("writes a Tickets sheet: header, a hyperlink ticket cell, a plain PM cell, numeric hours", () => {
    const ws = renderWorkbook(sampleModel(), preset).getWorksheet("Tickets")!;
    expect(ws.getRow(1).values).toContain("Ticket");
    const link = ws.getCell(2, 3).value as { text: string; hyperlink: string };
    expect(link.text).toBe("SAPS-1");
    expect(link.hyperlink).toBe("https://x.atlassian.net/browse/SAPS-1");
    expect(ws.getCell(3, 3).value).toBe("PM");
    expect(ws.getCell(2, 5).value).toBe(7);
  });

  it("writes the Overview EUR row as a live formula referencing the CZK cell", () => {
    const ws = renderWorkbook(sampleModel(), preset).getWorksheet("Overview")!;
    // Row 1 header, Row 2 hours, Row 3 CZK, Row 4 EUR.
    const eur = ws.getCell(4, 2).value as { formula: string; result?: number };
    expect(eur.formula).toBe("B3/24.2");
    expect(eur.result).toBeCloseTo(8150 / 24.2);
  });

  it("omits CZK/EUR rows when there is no rate", () => {
    const model = sampleModel();
    model.overview.groups = model.overview.groups.map((g) => ({ ...g, czk: null }));
    model.overview.totalCzk = null;
    const ws = renderWorkbook(model, preset).getWorksheet("Overview")!;
    expect(ws.getCell(3, 1).value).toBeNull();
  });
});
