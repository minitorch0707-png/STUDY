/**
 * Runs once when the LectureLab server starts. If the app has its own
 * (managed) AI engine installed, start it in the background so the AI is ready
 * by the time the student opens a lesson. Nothing is downloaded here.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const engine = await import("@/lib/engine");
  engine.installShutdownHooks();
  void engine.ensureEngine({ allowDownload: false });
}
