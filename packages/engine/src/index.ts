export const ENGINE_VERSION = "0.0.0";
export { normalizeSurface } from "./normalize.js";
export type { NormalizedSurface } from "./normalize.js";
export {
  compileLexicon,
  validateDocument,
} from "./validate.js";
export type {
  CompiledLexicon,
  LexiconEntry,
  SurfaceKind,
  ValidateOptions,
  ValidationCandidate,
  ValidationFinding,
  ValidationHighlight,
  ValidationResult,
  ValidationRule,
  ValidationSeverity,
  ValidationStats,
} from "./validate.js";
