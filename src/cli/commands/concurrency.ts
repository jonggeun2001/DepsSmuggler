const INVALID_CONCURRENCY_MESSAGE = '--concurrency는 양의 정수여야 합니다';

/**
 * Parse the legacy concurrency value while rejecting truncated positive input.
 *
 * The generic download command historically passed parseInt's result through,
 * and the OS command historically fell back for non-positive/NaN values. Keep
 * those results intact while validating values that look like positive input.
 */
export function parseConcurrency(value: string): number {
  const parsed = parseInt(value, 10);
  const completeValue = Number(value);
  const requiresPositiveValidation = parsed >= 0 || completeValue > 0;

  if (!requiresPositiveValidation) {
    return parsed;
  }

  if (
    !Number.isFinite(completeValue) ||
    !Number.isSafeInteger(completeValue) ||
    completeValue !== parsed
  ) {
    throw new Error(`${INVALID_CONCURRENCY_MESSAGE}: '${value}'`);
  }

  return parsed;
}
