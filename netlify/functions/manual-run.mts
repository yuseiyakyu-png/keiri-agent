import type { Config, Context } from "@netlify/functions";
import { runDailyJob } from "../../src/lib/run";

// 手動テスト用エンドポイント。 /.netlify/functions/manual-run?secret=xxx で叩く。
// 課題の「終わったと言える条件：手で動かすとSlackに投稿が届く」の確認用。
export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (!secret || secret !== process.env.MANUAL_RUN_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  try {
    const result = await runDailyJob();
    return new Response(JSON.stringify(result, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(String(err?.message ?? err), { status: 500 });
  }
};

export const config: Config = {
  path: "/manual-run",
};
