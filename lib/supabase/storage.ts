import "server-only";
import { getSupabaseAdmin } from "./admin";

const REPORTS_BUCKET = "reports";

/**
 * Uploads a generated report PDF to Supabase Storage and returns the
 * storage path to save in `reports.pdf_url`. Nothing calls this yet — PDF
 * generation ships in M2 (docs/15-mvp-scope-and-m0-plan.md §2) — but the
 * upload contract is defined now so M2 can use it directly.
 *
 * Requires a private "reports" bucket to exist in the Supabase project
 * (created manually in the dashboard, not by this code) before it's
 * actually called.
 */
export async function uploadReportPdf(
  reportId: string,
  pdf: Uint8Array,
): Promise<string> {
  const path = `${reportId}.pdf`;

  const { error } = await getSupabaseAdmin()
    .storage.from(REPORTS_BUCKET)
    .upload(path, pdf, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) {
    throw new Error(
      `Failed to upload report PDF (${reportId}): ${error.message}`,
    );
  }

  return path;
}

/**
 * Generates a time-limited signed URL for downloading a report PDF. The
 * "reports" bucket is private, not public — a report should only be
 * reachable by whoever holds the report_token, and a signed URL that
 * expires keeps a leaked download link from staying valid forever.
 */
export async function getReportPdfUrl(
  path: string,
  expiresInSeconds = 60 * 60,
): Promise<string> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(REPORTS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data) {
    throw new Error(
      `Failed to create signed URL for report PDF (${path}): ${error?.message ?? "unknown error"}`,
    );
  }

  return data.signedUrl;
}
