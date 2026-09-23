export type SseHandler = (event: string, data: unknown) => void;

/** Consume a fetch Response as Server-Sent Events. */
export async function readSse(res: Response, onEvent: SseHandler): Promise<void> {
  if (!res.ok) {
    const text = await res.text();
    let message = res.statusText;
    try {
      const body = text ? JSON.parse(text) : null;
      message = body?.error?.message ?? (typeof body?.error === "string" ? body.error : message);
    } catch {
      if (text) message = text.slice(0, 280);
    }
    throw new Error(message || `HTTP ${res.status}`);
  }
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    buf = buf.replace(/\r\n/g, "\n");
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      const raw = dataLines.join("\n");
      let data: unknown = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        /* keep string */
      }
      onEvent(event, data);
    }
  }
}
