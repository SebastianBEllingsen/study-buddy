import { toast } from "sonner";

// Saves that shouldn't hold up the UI — a flashcard rating moves straight
// on to the next card while this sends it. Runs one at a time, in order,
// retrying a dropped connection or server error a couple of times before
// telling the user. Closing the tab with saves still pending asks first.

interface Job {
  url: string;
  body: unknown;
  failMessage: string;
}

const RETRY_DELAYS_MS = [1000, 3000];

const jobs: Job[] = [];
let running = false;

export function saveInBackground(url: string, body: unknown, failMessage: string): void {
  jobs.push({ url, body, failMessage });
  void run();
}

async function run() {
  if (running) return;
  running = true;
  while (jobs.length > 0) {
    const job = jobs[0];
    const ok = await send(job);
    jobs.shift();
    if (!ok) toast.error(job.failMessage);
  }
  running = false;
}

async function send(job: Job): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(job.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job.body),
      });
      if (res.ok) return true;
      // A 4xx won't go through on a retry either.
      if (res.status < 500) return false;
    } catch {
      // Network error: retry below.
    }
    if (attempt >= RETRY_DELAYS_MS.length) return false;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (jobs.length > 0) event.preventDefault();
  });
}
