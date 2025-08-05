/**
 * Simple utility functions for value comparison and parsing
 */

export function parseValue(actualValue: unknown, expectedValue: unknown): unknown {
  // If expectedValue is already the right type (from POST), return as-is
  if (typeof expectedValue !== 'string') {
    return expectedValue;
  }

  // Parse string expectedValue to match actualValue type
  if (typeof actualValue === 'number') {
    const parsed = Number(expectedValue);
    if (isNaN(parsed)) {
      throw new Error(`Cannot convert '${expectedValue}' to number`);
    }
    return parsed;
  }
  
  if (typeof actualValue === 'boolean') {
    if (expectedValue !== 'true' && expectedValue !== 'false') {
      throw new Error(`Expected boolean value, got '${expectedValue}'`);
    }
    return expectedValue === 'true';
  }
  
  if (typeof actualValue === 'object' && actualValue !== null) {
    try {
      return JSON.parse(expectedValue as string);
    } catch {
      throw new Error(`Invalid JSON for object comparison: ${expectedValue}`);
    }
  }
  
  return expectedValue;
}

export function compareValues(actualValue: unknown, expectedValue: unknown): boolean {
  if (typeof actualValue === 'object' && actualValue !== null && 
      typeof expectedValue === 'object' && expectedValue !== null) {
    return JSON.stringify(actualValue) === JSON.stringify(expectedValue);
  }
  return actualValue === expectedValue;
}
