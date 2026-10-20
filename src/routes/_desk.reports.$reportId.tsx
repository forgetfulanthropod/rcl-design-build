import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { reviewReport } from "@/lib/server/fns";
import { ReportCard } from "@/components/report-card";
import { EmptyState, Skeleton } from "@/components/ui";
import { useDesk } from "@/components/desk-context";
import type { DailyReport } from "@/lib/server/reports.server";

export const Route = createFileRoute("/_desk/reports/$reportId")({ component: ReportRoute });

/** One report, shareable inside the company. Another company's id says "Not found". */
function ReportRoute() {
  const { reportId } = Route.useParams();
  const { setRecordTitle } = useDesk();
  const [report, setReport] = useState<DailyReport | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setMissing(false);
    reviewReport({ data: { id: reportId } })
      .then((next) => {
        if (cancelled) return;
        setReport(next);
        setRecordTitle(`${next.userName}'s report, ${next.day}`);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reportId, setRecordTitle]);
  return (
    <div className="mx-auto grid max-w-3xl gap-3">
      <Link to="/reports" className="inline-flex h-11 items-center text-sm text-copper underline">
        All reports
      </Link>
      {missing ? (
        <div data-testid="report-missing">
          <EmptyState title="Not found" body="This report isn't on your desk." />
        </div>
      ) : report ? (
        <ReportCard report={report} />
      ) : (
        <Skeleton lines={4} label="Opening the report" />
      )}
    </div>
  );
}
