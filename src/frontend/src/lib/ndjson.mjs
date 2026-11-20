// Read a newline-delimited JSON stream (one JSON object per line) and yield each object as soon as its line is complete.
// Reads with getReader() instead of `for await (... of body)`: Safari (so every browser on iPhone) cannot loop over a stream directly.
export async function* readNdjson(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end).trim();
                buffer = buffer.slice(end + 1);
                if (line) yield JSON.parse(line);
            }
        }
        buffer += decoder.decode();
        if (buffer.trim()) yield JSON.parse(buffer);
    } finally {
        reader.releaseLock();
    }
}
