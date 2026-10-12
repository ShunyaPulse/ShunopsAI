/** A single Server-Sent Event message. */
export interface SSEEvent {
  event?: string | undefined;
  data: string;
}

/** Format one Server-Sent Event message string. */
export function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Parse an upstream Server-Sent Events byte stream into individual messages.
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep remainder

      let currentEvent: string | undefined = undefined;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          currentEvent = undefined;
          continue;
        }
        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim();
        } else if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          yield { event: currentEvent, data };
        }
      }
    }

    if (buffer.trim().startsWith('data:')) {
      yield { data: buffer.trim().slice(5).trim() };
    }
  } finally {
    reader.releaseLock();
  }
}
