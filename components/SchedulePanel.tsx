"use client";

import { useEffect, useRef } from "react";

import { formatDateTime, formatTime } from "@/lib/dates";
import { StaleReason, indexTasks, resolveBlock, staleMessage } from "@/lib/schedule";
import { RestMode, Schedule, Task } from "@/lib/types";
import RestKinds from "./RestKinds";

type Props = {
  schedule: Schedule | null;
  tasks: Task[];
  endTime: string;
  now: Date;
  staleReason: StaleReason;
  restMode: RestMode;
  onRestModeChange: (next: RestMode) => void;
  onEndTimeChange: (value: string) => void;
  onGenerate: () => void;
};

export default function SchedulePanel({
  schedule,
  tasks,
  endTime,
  now,
  staleReason,
  restMode,
  onRestModeChange,
  onEndTimeChange,
  onGenerate,
}: Props) {
  const byId = indexTasks(tasks);

  const listRef = useRef<HTMLDivElement | null>(null);
  const nowRef = useRef<HTMLDivElement | null>(null);
  const hasScrolledRef = useRef(false);

  const nowStart =
    schedule?.blocks.find(
      (block) => new Date(block.end) > now && new Date(block.start) <= now,
    )?.start ?? null;

  // Park the current block at the top of the list, on first paint and again
  // whenever a different block becomes the current one.
  useEffect(() => {
    const list = listRef.current;
    const current = nowRef.current;
    if (!list || !current) return;

    const top =
      current.getBoundingClientRect().top -
      list.getBoundingClientRect().top +
      list.scrollTop;

    // Smooth only for a live handover, and only while the tab is visible: a
    // hidden tab freezes the animation, so the jump would never land.
    const smooth = hasScrolledRef.current && !document.hidden;
    list.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
    hasScrolledRef.current = true;
  }, [nowStart, schedule?.generatedAt]);

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

      <RestKinds restMode={restMode} onChange={onRestModeChange} />

      {staleReason && (
        <div className="banner warn">
          <span aria-hidden="true">⚠</span>
          <span>
            <strong>This schedule is outdated.</strong>{" "}
            {staleMessage(staleReason)}{" "}
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
          <div className="blocks" ref={listRef}>
            {schedule.blocks.map((block) => {
              const start = new Date(block.start);
              const end = new Date(block.end);
              const isPast = end <= now;
              const isNow = !isPast && start <= now;
              const { title, isRest, isMissing } = resolveBlock(block, byId, restMode);

              return (
                <div
                  key={block.start}
                  ref={isNow ? nowRef : null}
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
