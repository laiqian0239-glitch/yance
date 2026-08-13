import { cn } from "./_adapter";
import type { ProgressStep, ProgressTrackerProps } from "./schema";
import { Check, X, Loader2, Timer, AlertCircle } from "lucide-react";

function formatElapsedTime(milliseconds: number): string {
  const seconds = milliseconds / 1000;

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function formatElapsedTimeDateTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, milliseconds) / 1000;

  if (totalSeconds < 60) {
    return `PT${Number(totalSeconds.toFixed(1))}S`;
  }

  const wholeSeconds = Math.floor(totalSeconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = wholeSeconds % 60;

  const hourPart = hours > 0 ? `${hours}H` : "";
  const minutePart = minutes > 0 ? `${minutes}M` : "";
  const secondPart = seconds > 0 ? `${seconds}S` : "";

  if (!hourPart && !minutePart && !secondPart) {
    return "PT0S";
  }

  return `PT${hourPart}${minutePart}${secondPart}`;
}

function getCurrentStepId(steps: ProgressStep[]): string | null {
  const inProgressStep = steps.find((s) => s.status === "in-progress");
  if (inProgressStep) return inProgressStep.id;

  const failedStep = steps.find((s) => s.status === "failed");
  if (failedStep) return failedStep.id;

  const firstPendingStep = steps.find((s) => s.status === "pending");
  if (firstPendingStep) return firstPendingStep.id;

  return null;
}

interface StepIndicatorProps {
  status: "pending" | "in-progress" | "completed" | "failed";
}

function StepIndicator({ status }: StepIndicatorProps) {
  if (status === "pending") {
    return (
      <span
        className="bg-card border-border flex size-6 shrink-0 items-center justify-center rounded-full border motion-safe:transition-all motion-safe:duration-200"
        aria-hidden="true"
      />
    );
  }

  if (status === "in-progress") {
    return (
      <span
        className="bg-card border-border flex size-6 shrink-0 items-center justify-center rounded-full border shadow-[0_0_0_4px_hsl(var(--primary)/0.1)] motion-safe:transition-all motion-safe:duration-300"
        aria-hidden="true"
      >
        <Loader2 className="text-primary size-5 motion-safe:animate-spin" />
      </span>
    );
  }

  if (status === "completed") {
    return (
      <span
        className="bg-primary text-primary-foreground border-primary flex size-6 shrink-0 items-center justify-center rounded-full border shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75 motion-safe:duration-300 motion-safe:ease-out"
        aria-hidden="true"
      >
        <Check
          className="size-4 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75 motion-safe:delay-75 motion-safe:duration-200 motion-safe:fill-mode-both"
          strokeWidth={3}
        />
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span
        className="bg-destructive border-destructive flex size-6 shrink-0 items-center justify-center rounded-full border text-white shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75 motion-safe:duration-300 motion-safe:ease-out dark:border-red-600 dark:bg-red-600"
        aria-hidden="true"
      >
        <X
          className="size-4 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75 motion-safe:delay-75 motion-safe:duration-200 motion-safe:fill-mode-both"
          strokeWidth={3}
        />
      </span>
    );
  }

  return null;
}

export function ProgressTracker({
  id,
  steps,
  elapsedTime,
  className,
  choice,
}: ProgressTrackerProps) {
  const hasInProgress = steps.some((step) => step.status === "in-progress");
  const currentStepId = getCurrentStepId(steps);

  const viewKey = choice ? `receipt-${choice.outcome}` : "interactive";
  const receiptOutcome = choice?.outcome;
  const receiptSummary = choice?.summary;
  const isReceiptSuccess = receiptOutcome === "success";
  const isReceiptFailed = receiptOutcome === "failed";

  return (
    <div key={viewKey} className="contents">
      {choice ? (
        <div
          className={cn(
            "flex w-full max-w-md min-w-80 flex-col",
            "text-foreground select-none",
            "motion-safe:animate-in motion-safe:fade-in motion-safe:blur-in-sm motion-safe:zoom-in-95 motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)] motion-safe:fill-mode-both",
            className,
          )}
          data-slot="progress-tracker"
          data-tool-ui-id={id}
          data-receipt="true"
          role="status"
          aria-label={receiptSummary}
        >
          <div className="bg-card/60 flex w-full flex-col gap-4 rounded-2xl border p-5 shadow-xs">
            <div className="flex items-center justify-between">
              {elapsedTime !== undefined && elapsedTime > 0 && (
                <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
                  <Timer className="-mt-px size-3.5" />
                  <time dateTime={formatElapsedTimeDateTime(elapsedTime)}>
                    {formatElapsedTime(elapsedTime)}
                  </time>
                </div>
              )}
              <span
                className={cn(
                  "flex items-center gap-1.5 text-xs font-medium",
                  isReceiptSuccess && "text-emerald-600 dark:text-emerald-500",
                  isReceiptFailed && "text-destructive",
                  !isReceiptSuccess &&
                    !isReceiptFailed &&
                    "text-muted-foreground",
                )}
              >
                {isReceiptSuccess ? (
                  <Check className="size-3.5" />
                ) : isReceiptFailed ? (
                  <AlertCircle className="size-3.5" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {receiptSummary}
              </span>
            </div>

            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {steps.map((step, index) => (
                <li
                  key={step.id}
                  className="relative -mx-2 flex items-start gap-3 rounded-lg px-2 py-1.5"
                >
                  {index < steps.length - 1 && (
                    <div
                      className="bg-border absolute top-8 left-5 w-px"
                      style={{
                        height: "calc(100% + 0.5rem)",
                      }}
                      aria-hidden="true"
                    />
                  )}
                  <div className="relative z-10">
                    <StepIndicator status={step.status} />
                  </div>
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="text-sm leading-6 font-medium">
                      {step.label}
                    </span>
                    {step.description && (
                      <span className="text-muted-foreground text-sm">
                        {step.description}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : (
        <article
          className={cn(
            "flex w-full max-w-md min-w-80 flex-col gap-3",
            "text-foreground select-none",
            className,
          )}
          data-slot="progress-tracker"
          data-tool-ui-id={id}
          role="status"
          aria-live="polite"
          aria-busy={hasInProgress}
        >
          <div className="bg-card flex w-full flex-col gap-4 rounded-2xl border p-5 shadow-xs">
            {elapsedTime !== undefined && elapsedTime > 0 && (
              <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
                <Timer className="-mt-px size-3.5" />
                <time dateTime={formatElapsedTimeDateTime(elapsedTime)}>
                  {formatElapsedTime(elapsedTime)}
                </time>
              </div>
            )}

            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {steps.map((step, index) => {
                const isCurrent = step.id === currentStepId;
                const isActive = step.status === "in-progress";
                const isFailed = step.status === "failed";
                const hasDescription = !!step.description;
                const shouldShowDescription = isActive || isFailed;

                return (
                  <li
                    key={step.id}
                    className="relative -mx-2"
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    {index < steps.length - 1 && (
                      <div
                        className={cn(
                          "bg-border absolute top-6 left-5 w-px",
                          "motion-safe:transition-all motion-safe:duration-300",
                        )}
                        style={{
                          height: "calc(100% + 0.25rem)",
                        }}
                        aria-hidden="true"
                      />
                    )}
                    <div
                      className={cn(
                        "relative z-10 flex items-start gap-3 rounded-lg px-2 py-1.5",
                        "motion-safe:transition-all motion-safe:duration-300",
                        isCurrent && "bg-primary/5",
                      )}
                      style={{
                        backdropFilter: isCurrent ? "blur(2px)" : undefined,
                      }}
                    >
                      <div className="relative z-10">
                        <StepIndicator status={step.status} />
                      </div>
                      <div className="flex flex-1 flex-col">
                        <span
                          className={cn(
                            "text-sm leading-6 font-medium",
                            step.status === "pending" &&
                              "text-muted-foreground",
                            step.status === "in-progress" &&
                              "motion-safe:shimmer shimmer-invert text-foreground",
                          )}
                        >
                          {step.label}
                        </span>
                        {hasDescription && (
                          <div
                            className={cn(
                              "grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-300 motion-safe:ease-out",
                              shouldShowDescription
                                ? "grid-rows-[1fr] opacity-100"
                                : "grid-rows-[0fr] opacity-0",
                            )}
                          >
                            <div className="overflow-hidden">
                              <span className="text-muted-foreground block pt-0.5 text-sm">
                                {step.description}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </article>
      )}
    </div>
  );
}
