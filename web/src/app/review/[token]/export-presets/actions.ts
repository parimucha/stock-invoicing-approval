"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseExportPresetConfig } from "@/lib/invoice-export-config";

// Authenticate the reviewer by resolving their report token. Presets are
// global today; the token proves the caller is a legitimate reviewer.
async function requireReviewer(token: string) {
  const report = await prisma.report.findUnique({ where: { magicToken: token } });
  if (!report) notFound();
  return report;
}

// parseExportPresetConfig returns the validated ExportPresetConfig shape;
// cast to Prisma's Json input type (it has no index signature of its own,
// same reasoning as the `as unknown as ExportPresetConfig` cast on read in
// page.tsx) so it can be written to the Json `config` column.
function readConfig(formData: FormData): Prisma.InputJsonValue {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("config") ?? "null"));
  } catch {
    throw new Error("Preset config is not valid JSON.");
  }
  return parseExportPresetConfig(raw) as unknown as Prisma.InputJsonValue;
}

export async function createPreset(formData: FormData) {
  const token = String(formData.get("token"));
  await requireReviewer(token);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Preset name is required.");
  const config = readConfig(formData);
  await prisma.exportPreset.create({ data: { name, config } });
  revalidatePath(`/review/${token}/export-presets`);
}

export async function updatePreset(formData: FormData) {
  const token = String(formData.get("token"));
  await requireReviewer(token);
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Preset name is required.");
  const config = readConfig(formData);
  await prisma.exportPreset.update({ where: { id }, data: { name, config } });
  revalidatePath(`/review/${token}/export-presets`);
}

export async function deletePreset(formData: FormData) {
  const token = String(formData.get("token"));
  await requireReviewer(token);
  const id = String(formData.get("id"));
  await prisma.exportPreset.delete({ where: { id } });
  revalidatePath(`/review/${token}/export-presets`);
}
