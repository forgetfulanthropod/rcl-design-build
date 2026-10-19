import { NO_JOB_LABEL } from "@/lib/current-job";

/**
 * Job picker. Required ("Pick a job") unless `companyWide` allows "Company-wide (no job)",
 * which sits at the bottom. The label says "(your job today)" while the current job is picked.
 */
export function JobSelect({
  id,
  jobs,
  value,
  onChange,
  companyWide = false,
  currentHint = false,
  label = "Job",
  className = "field",
  disabled,
  onBlur,
  labelClassName = "text-sm text-muted",
}: {
  id: string;
  jobs: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  companyWide?: boolean;
  currentHint?: boolean;
  label?: string;
  className?: string;
  disabled?: boolean;
  onBlur?: () => void;
  labelClassName?: string;
}) {
  return (
    <>
      <label className={labelClassName} htmlFor={id}>
        {label}
        {currentHint && value ? <span className="ml-1 text-muted">(your job today)</span> : null}
      </label>
      <select
        id={id}
        className={className}
        value={value}
        required={!companyWide}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
      >
        {!companyWide ? (
          <option value="" disabled>
            Pick a job
          </option>
        ) : null}
        {jobs.map((job) => (
          <option key={job.id} value={job.id}>
            {job.name}
          </option>
        ))}
        {companyWide ? <option value="">{NO_JOB_LABEL}</option> : null}
      </select>
    </>
  );
}
