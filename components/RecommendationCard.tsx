"use client";

import { DateKey, describeDelta, formatDateTime, formatDueDate } from "@/lib/dates";
import { Recommendation, Task } from "@/lib/types";
import { REST_LABEL, formatProbability } from "@/lib/weights";

type Props = {
  recommendation: Recommendation | null;
  tasks: Task[];
  today: DateKey;
  probabilityOf: (taskId: string) => number;
  onRecommend: () => void;
  canRecommend: boolean;
};

export default function RecommendationCard({
  recommendation,
  tasks,
  today,
  probabilityOf,
  onRecommend,
  canRecommend,
}: Props) {
  const task = recommendation?.taskId
    ? (tasks.find((t) => t.id === recommendation.taskId) ?? null)
    : null;
  const isRest = recommendation !== null && recommendation.taskId === null;
  const wasDeleted = recommendation?.taskId != null && task === null;

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Up next</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onRecommend}
          disabled={!canRecommend}
        >
          {recommendation ? "Draw again" : "Recommend"} <span className="kbd">R</span>
        </button>
      </div>

      {!recommendation ? (
        <div className="rec-body">
          <div className="rec-empty">
            No recommendation yet — press <span className="kbd">R</span> to draw one.
          </div>
        </div>
      ) : (
        <div className="rec-body">
          <div className="rec-label">{isRest ? "Take a break" : "Work on this"}</div>
          <h3 className={`rec-title${isRest ? " is-rest" : ""}`}>
            {isRest ? REST_LABEL : recommendation.title}
          </h3>

          {task?.description && <p className="rec-desc">{task.description}</p>}

          <div className="rec-meta">
            {task && (
              <>
                <span>Due {formatDueDate(task.dueDate, today).toLowerCase()}</span>
                <span>{describeDelta(task.dueDate, today)}</span>
                <span>{formatProbability(probabilityOf(task.id))} chance</span>
              </>
            )}
            {isRest && <span>The hidden Rest task came up — step away for a bit.</span>}
            <span style={{ color: "var(--text-faint)" }}>
              Drawn {formatDateTime(recommendation.generatedAt)}
            </span>
          </div>

          {wasDeleted && (
            <div className="rec-note">This task has since been deleted.</div>
          )}
          {task?.completed && (
            <div className="rec-note">You have completed this one — draw again.</div>
          )}
        </div>
      )}
    </section>
  );
}
