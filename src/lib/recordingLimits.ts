// Size limits of a consultation recording, shared by the recorder and the
// consultation screen.

/** transcribe-consultation refuses audio above this size (413) and cannot split it. */
export const AUDIO_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
/** The recording stops by itself here, leaving room for the last chunks. */
export const RECORDING_STOP_BYTES = 24 * 1024 * 1024;
/** The doctor is warned from here on. */
export const RECORDING_WARN_BYTES = 20 * 1024 * 1024;
/** Speech at 32 kbps is about 15 MB per hour, so a normal consultation stays far from the limit. */
export const RECORDING_BITS_PER_SECOND = 32_000;
