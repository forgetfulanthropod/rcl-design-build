import type { DailyReport } from "@/lib/server/reports.server";
import { clock, longDay } from "@/components/today-report";
import { PhotoThumb } from "@/components/photo-thumb";

export function ReportCard({ report, showPerson = true, highlight = false }: { report: DailyReport; showPerson?: boolean; highlight?: boolean }) {
  return (
    <article
      id={`report-${report.id}`}
      data-testid="report-card"
      className={`scroll-mt-4 rounded-md border bg-surface p-4 ${highlight ? "border-copper" : "border-line"}`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg text-fg">
          {showPerson ? `${report.userName} · ` : ""}
          {longDay(report.day)}
        </h3>
        <p className="text-sm text-muted">
          {report.submittedAt ? `Submitted ${clock(report.submittedAt)}` : "Not submitted"}
        </p>
      </header>
      {report.projectName ? <p className="mt-1 text-sm text-copper">{report.projectName}</p> : null}
      <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-fg">{report.narrative || "No narrative yet."}</p>
      {report.photos.length > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {report.photos.map((p) => (
            <PhotoThumb key={p.id} id={p.id} thumb={p.thumb} alt={`Photo from ${report.userName}`} />
          ))}
        </div>
      ) : null}
      <p className="mt-3 text-sm text-muted tabular-nums">
        First edit {clock(report.firstEditAt)} · Last edit {clock(report.lastEditAt)} · Lunch{" "}
        {report.lunchMinutes == null ? "—" : `${report.lunchMinutes} min`}
      </p>
    </article>
  );
}
