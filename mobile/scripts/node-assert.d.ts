// The app's tsconfig has no Node types (it's a React Native project); the
// community lib test script runs under node via tsx and only needs this much.
declare module "node:assert/strict" {
  type Assert = {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal<T>(actual: unknown, expected: T, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual<T>(actual: unknown, expected: T, message?: string): void;
  };
  const assert: Assert;
  export default assert;
}
