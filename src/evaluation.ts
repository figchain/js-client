

import { FigFamily, Fig, Rule, Condition, Operator } from './models';

export type Context = Record<string, unknown>;

export class Evaluator {
  evaluate(family: FigFamily, context: Context): Fig | null {
    // 1. Evaluate Rules
    if (family.rules) {
      for (const rule of family.rules) {
        if (this.matches(rule, context)) {
          return this.findFig(family, rule.targetVersion);
        }
      }
    }

    // 2. Default Version
    if (family.defaultVersion) {
      const fig = this.findFig(family, family.defaultVersion);
      if (fig) {return fig;}
    }

    // 3. Fallback to first available
    if (family.figs && family.figs.length > 0) {
        return family.figs[0];
    }

    return null;
  }

  private matches(rule: Rule, context: Context): boolean {
    if (!rule.conditions || rule.conditions.length === 0) {return true;}
    return rule.conditions.every(c => ConditionEvaluator.evaluate(c, context));
  }

  private findFig(family: FigFamily, version: string): Fig | null {
    return family.figs.find(f => f.version === version) || null;
  }
}

class ConditionEvaluator {
  static evaluate(condition: Condition, context: Context): boolean {
    const value = context[condition.variable];
    if (value === undefined || value === null) {
        return false;
    }

    const strValue = String(value);
    const ruleValue = condition.values.length > 0 ? condition.values[0] : null;

    switch (condition.operator) {
      case Operator.EQUALS:
        return condition.values.includes(strValue);
      case Operator.NOT_EQUALS:
        return !condition.values.includes(strValue);
      case Operator.IN:
        return condition.values.includes(strValue);
      case Operator.NOT_IN:
        return !condition.values.includes(strValue);
      case Operator.CONTAINS:
        return ruleValue !== null && strValue.includes(ruleValue);
      case Operator.GREATER_THAN:
        return ruleValue !== null && parseFloat(strValue) > parseFloat(ruleValue);
      case Operator.LESS_THAN:
        return ruleValue !== null && parseFloat(strValue) < parseFloat(ruleValue);
      case Operator.SPLIT:
        if (ruleValue === null) {return false;}
        try {
            const threshold = parseInt(ruleValue, 10);
            const bucket = this.getBucket(strValue);
            return bucket < threshold;
        } catch {
            return false;
        }
      default:
        return false;
    }
  }

  private static getBucket(key: string): number {
      const FNV_OFFSET_BASIS = 2166136261;
      const FNV_PRIME = 16777619;

      let hash = FNV_OFFSET_BASIS;
      const buffer = Buffer.from(key, 'utf8');

      for (let i = 0; i < buffer.length; i++) {
          hash = (hash ^ buffer[i]) >>> 0; // XOR and Force Unsigned
          hash = Math.imul(hash, FNV_PRIME) >>> 0; // Multiply and Force Unsigned
      }

      // Convert to signed 32-bit integer for consistent bucketing
      const signedHash = hash | 0;

      // abs(fmod(hash, 100))
      // JS % operator is remainder, not modulo, but for positive numbers it matches.
      // Math.abs(signedHash % 100)

      return Math.abs(signedHash % 100);
  }
}
