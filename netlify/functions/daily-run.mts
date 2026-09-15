import type { Config } from "@netlify/functions";
import { runDailyJob } from "../../src/lib/run";

// 毎朝の自動実行本体。cronはUTCで評価されるため "0 0 * * *" = 日本時間9:00。
export default async () => {
  const result = await runDailyJob();
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  schedule: "0 0 * * *",
};
