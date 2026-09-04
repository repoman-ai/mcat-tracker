import { isStudyRow, weekRows } from "./data.js";
import { todayISO } from "./utils.js";

export function reducedMotion(setting, systemReduced = false) {
  return setting === "on" || (setting !== "off" && systemReduced);
}
export function completionFeedback(row, before, after, origin, today, preview = false) {
  const day = before?.status !== "complete" && after?.status === "complete";
  return { day, burst: day && row.date === today && ["today", "dialog"].includes(origin) && !preview };
}
export function createCelebrationController(document, window) {
  const celebrated = new Set();
  let cancel = () => {};
  const stop = () => { cancel(); cancel = () => {}; };
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let preference = "system";
  media.addEventListener("change", () => { stop(); document.documentElement.dataset.reduceMotion = reducedMotion(preference, media.matches) ? "on" : "off"; });
  return {
    stop,
    applyPreference(setting) {
      preference = setting;
      stop();
      document.documentElement.dataset.reduceMotion = reducedMotion(setting, media.matches) ? "on" : "off";
    },
    celebrate({ row, previous, next, taskId, origin }, state, data) {
      const effect = completionFeedback(row, previous, next, origin, todayISO(), new URLSearchParams(window.location.search).has("today"));
      const scope = document.querySelector("dialog[open]") || document;
      const selector = taskId ? `[data-task-assignment="${CSS.escape(row.id)}"][data-toggle-task="${CSS.escape(taskId)}"]` : `[data-toggle-complete="${CSS.escape(row.id)}"]`;
      const target = scope.querySelector(selector);
      const motion = !reducedMotion(state.settings.reducedMotionOverride, media.matches);
      if (motion && target) {
        const box = target.querySelector(".task-check__box, .completion-check__box");
        box?.animate?.([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 170 });
      }
      if (!effect.day) return "";
      const rows = weekRows(data, row.week).filter(isStudyRow);
      const count = rows.filter((item) => state.daily[item.id]?.status === "complete").length;
      const message = `${row.date === todayISO() ? "Today's plan" : row.date} complete.${rows.length ? ` Week ${row.week}: ${count} of ${rows.length} study days.` : ""}`;
      if (!effect.burst || celebrated.has(row.id)) return message;
      celebrated.add(row.id);
      if (!motion || !target) return message;
      stop();
      const canvas = document.createElement("canvas");
      canvas.className = "celebration-canvas";
      canvas.setAttribute("aria-hidden", "true");
      const dialog = document.querySelector("dialog[open]");
      (dialog || document.body).append(canvas);
      const rect = target.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const width = canvasRect.width, height = canvasRect.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * ratio; canvas.height = height * ratio;
      const ctx = canvas.getContext("2d");
      if (!ctx) { canvas.remove(); return message; }
      ctx.scale(ratio, ratio);
      const x = Math.max(20, Math.min(width - 20, rect.left + rect.width / 2 - canvasRect.left));
      const y = Math.max(30, Math.min(height - 40, rect.top + rect.height / 2 - canvasRect.top));
      const particles = Array.from({ length: 36 }, (_, i) => ({ vx: (Math.random() - .5) * 200, vy: -80 - Math.random() * 160, color: ["#416e5c", "#d6a65d", "#80a7b0"][i % 3], rotation: Math.random() * 6 }));
      const start = window.performance.now();
      let frame;
      cancel = () => { window.cancelAnimationFrame(frame); canvas.remove(); };
      const draw = (now) => {
        const t = (now - start) / 1000;
        if (t > 1.1 || !canvas.isConnected) { stop(); return; }
        ctx.clearRect(0, 0, width, height);
        ctx.globalAlpha = Math.min(1, (1.1 - t) * 3);
        for (const p of particles) {
          ctx.save(); ctx.translate(x + p.vx * t, y + p.vy * t + 170 * t * t); ctx.rotate(p.rotation + t * 3);
          ctx.fillStyle = p.color; ctx.fillRect(-3, -2, 6, 4); ctx.restore();
        }
        frame = window.requestAnimationFrame(draw);
      };
      frame = window.requestAnimationFrame(draw);
      return message;
    },
  };
}
