// src/agent/limits.ts — what the server accepts, known to the bar too: a question over it is said at the
// bar, before sending, not refused afterwards as "That question couldn't be sent." (a pasted page of notes).

/** The longest question /api/ask and /api/scout take (characters, trimmed). */
export const QUESTION_MAX = 2000;
