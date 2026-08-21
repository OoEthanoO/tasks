"use client";

import { formatDateTime, formatTime } from "@/lib/dates";
import { StaleReason, indexTasks, resolveBlock } from "@/lib/schedule";
import { Schedule, Task } from "@/lib/types";

type Props = {
  schedule: Schedule | null;
  tasks: Task[];
  endTime: string;
  now: Date;
  staleReason: StaleReason;
  onEndTimeChange: (value: string) => void;
  onGenerate: () => void;
};

export default function SchedulePanel({
  schedule,
  tasks,
  endTime,
  now,
  staleReason,
  onEndTimeChange,
  onGenerate,
}: Props) {
  const byId = indexTasks(tasks);

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Today&apos;s schedule</h2>
        <button type="button" className="btn" onClick={onGenerate}>
          {schedule ? "Regenerate" : "Generate"} <span className="kbd">G</span>
        </button>
      </div>

      <div className="sched-controls">
        <label htmlFor="end-time">Work day ends at</label>
        <input
          id="end-time"
          type="time"
          className="time-input"
          value={endTime}
          onChange={(e) => e.target.value && onEndTimeChange(e.target.value)}
        />
      </div>

      {staleReason && (
        <div className="banner warn">
          <span aria-hidden="true">⚠</span>
          <span>
            <strong>This schedule is outdated.</strong>{" "}
            {staleReason === "day"
              ? "It was generated on a different day."
              : "Your task list has changed since it was generated."}{" "}
            Regenerate it to get fresh picks.
          </span>
        </div>
      )}

      {!schedule ? (
        <div className="empty">
          <p>No schedule yet.</p>
          <p>
            Press <span className="kbd">G</span> to block out the rest of your day.
          </p>
        </div>
      ) : schedule.blocks.length === 0 ? (
        <div className="empty">
          <p>The work day was already over when this was generated.</p>
          <p>Push the end time later and regenerate.</p>
        </div>
      ) : (
        <>
          <div className="blocks">
            {schedule.blocks.map((block) => {
              const start = new Date(block.start);
              const end = new Date(block.end);
              const isPast = end <= now;
              const isNow = !isPast && start <= now;
              const { title, isRest, isMissing } = resolveBlock(block, byId);

              return (
                <div
                  key={block.start}
                  className={`block${isPast ? " is-past" : ""}${isNow ? " is-now" : ""}`}
                >
                  <span className="block-time">
                    {formatTime(start)} – {formatTime(end)}
                  </span>
                  <span
                    className={`block-task${isRest ? " is-rest" : ""}${
                      isMissing ? " is-gone" : ""
                    }`}
                  >
                    {title}
                  </span>
                  {isNow && <span className="now-tag">Now</span>}
                </div>
              );
            })}
          </div>

          <div className="stats">
            <span>
              Generated <b>{formatDateTime(schedule.generatedAt)}</b>
            </span>
            <span>
              <b>{schedule.blocks.length}</b> blocks
            </span>
            <span>
              <b>{schedule.blocks.filter((b) => b.taskId === null).length}</b> rest
            </span>
          </div>
        </>
      )}
    </section>
  );
}
