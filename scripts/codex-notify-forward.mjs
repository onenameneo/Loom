#!/usr/bin/env node

const [, , token, port, rawPayload] = process.argv;

async function main() {
  if (!token || !port || !rawPayload) return;

  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return;
  }

  try {
    await fetch(`http://127.0.0.1:${port}/codex`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Codex notify must never be blocked by Loom being closed or unreachable.
  }
}

void main();
